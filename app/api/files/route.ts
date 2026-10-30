import { asc, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { apiError, isTeamMember, newId, persistIdentity, readIdentity } from "../_lib";
import { channels, files, messages } from "../../../db/schema";

const maxFileSize = 20 * 1024 * 1024;
const maxTotalSize = 30 * 1024 * 1024;
const maxFileCount = 5;
const extensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"]);
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp",
  "application/vnd.hancom.hwpx", "application/haansofthwpx",
]);

function cleanName(value: string) {
  const name = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  return name.slice(0, 180) || "attachment";
}

function contentTypeFor(file: File) {
  const type = file.type.toLowerCase();
  const extension = cleanName(file.name).split(".").pop()?.toLowerCase() ?? "";
  if (type && allowedTypes.has(type)) return type;
  if (!extensions.has(extension)) return null;
  const inferred: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
    hwp: "application/x-hwp", hwpx: "application/vnd.hancom.hwpx", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", csv: "text/csv",
  };
  return inferred[extension] ?? null;
}

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  const bucket = env.BUCKET;
  if (!bucket) return apiError("파일 저장소가 아직 연결되지 않았습니다.", 503);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxTotalSize + 1024 * 1024) return apiError("한 번에 올리는 파일은 총 30MB 이하여야 합니다.", 413);

  let form: FormData;
  try { form = await request.formData(); } catch { return apiError("파일 업로드 요청을 읽을 수 없습니다."); }
  const teamId = String(form.get("teamId") ?? "").trim();
  const uploads = form.getAll("files").filter((value): value is File => value instanceof File && value.name.length > 0);
  if (!teamId || uploads.length === 0) return apiError("팀과 올릴 파일을 선택해 주세요.");
  if (uploads.length > maxFileCount) return apiError("한 번에 최대 5개까지 올릴 수 있습니다.");
  const totalSize = uploads.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxTotalSize) return apiError("한 번에 올리는 파일은 총 30MB 이하여야 합니다.", 413);
  if (uploads.some((file) => file.size <= 0 || file.size > maxFileSize)) return apiError("파일은 각각 20MB 이하여야 합니다.", 413);

  const prepared = uploads.map((file) => ({ file, name: cleanName(file.name), contentType: contentTypeFor(file) }));
  if (prepared.some((item) => !item.contentType)) return apiError("JPG, PNG, GIF, WebP, PDF, HWP, Office, TXT, CSV 파일만 올릴 수 있습니다.");

  const db = await persistIdentity(identity);
  if (!(await isTeamMember(db, teamId, identity.id))) return apiError("이 팀에 파일을 올릴 수 없습니다.", 403);
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.teamId, teamId)).orderBy(asc(channels.createdAt)).limit(1);
  if (!channel) return apiError("파일을 공유할 대화 채널이 없습니다.", 409);

  const stored: Array<{ id: string; key: string; name: string; contentType: string; size: number }> = [];
  try {
    for (const item of prepared) {
      const id = newId("file");
      const key = `teams/${teamId}/${id}`;
      await bucket.put(key, await item.file.arrayBuffer(), { httpMetadata: { contentType: item.contentType! } });
      stored.push({ id, key, name: item.name, contentType: item.contentType!, size: item.file.size });
    }
    await db.insert(files).values(stored.map((file) => ({
      id: file.id,
      teamId,
      uploadedBy: identity.id,
      originalName: file.name,
      contentType: file.contentType,
      size: file.size,
      objectKey: file.key,
    })));
    await db.insert(messages).values(stored.map((file) => ({
      id: newId("msg"),
      teamId,
      channelId: channel.id,
      authorId: identity.id,
      authorType: "user",
      fileId: file.id,
      body: `파일을 공유했어요: ${file.name}`,
    })));
    return Response.json({ files: stored.map(({ id, name, contentType, size }) => ({ id, name, contentType, size, url: `/api/files/${encodeURIComponent(id)}` })) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await Promise.all(stored.map((file) => bucket.delete(file.key).catch(() => undefined)));
    if (stored.length) await db.delete(files).where(inArray(files.id, stored.map((file) => file.id))).catch(() => undefined);
    console.error("file upload failed", error);
    return apiError("파일을 저장하지 못했습니다.", 500);
  }
}
