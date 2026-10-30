declare namespace Cloudflare {
  interface Env {
    CONNECTORS?: import("./lib/connector-contract.mjs").ConnectorBinding;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
