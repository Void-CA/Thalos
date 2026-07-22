// ── Repair Session Types (M8.4) ──

export interface CreateSessionResponse {
  session_id: number;
}

export interface PreviewRequest {
  region_id: number;
  strategy: string;
}

export interface PreviewResponse {
  candidate_id: number;
  base_revision: number;
  continuity_ok: boolean;
  improvement: number;
}

export interface ApplyRequest {
  candidate_id: number;
}

export interface ApplyResponse {
  new_revision: number;
  status: string;
  history_length: number;
}
