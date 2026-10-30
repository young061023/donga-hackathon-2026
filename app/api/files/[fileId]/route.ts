import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../../_lib";
import { files } from "../../../../db/schema";

function encodeFilename(name: string) {
  return encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  const bucket = env.BUCKET;
  if (!bucket) return apiError("파일 저장소가 아직 연결되지 않았습니다.", 503);
  try {
    const { fileId } = await params;
    const db = await persistIdentity(identity);
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file || !(await isTeamMember(db, file.teamId, identity.id))) return apiError("파일을 찾을 수 없습니다.", 404);
    const object = await bucket.get(file.objectKey);
    if (!object) return apiError("파일이 저장소에 없습니다.", 404);
    const asciiName = file.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
    const inline = file.contentType.startsWith("image/") || file.contentType === "application/pdf";
    return new Response(object.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeFilename(file.originalName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("file download failed", error);
    return apiError("파일을 불러오지 못했습니다.", 500);
  }
}
