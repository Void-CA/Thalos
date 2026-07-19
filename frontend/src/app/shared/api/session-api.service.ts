import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';
import type { RuntimeStateResponse } from '../../features/scene/scene-api.types';

export interface SessionResponse {
  id: number;
  plan_id: string;
  source: string;
  status: string;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  duration: number;
  joint_count: number;
  robot_name: string;
}

export interface TraceData {
  samples: TraceSample[];
}

export interface TraceSample {
  timestamp: number;
  joints: number[];
  velocities: number[];
  target_joints: number[] | null;
  progress: number;
  errors: string[];
}

export interface ImportRequest {
  trace_json: string;
  robot_name?: string;
}

export interface SessionSummary {
  session_id: number;
  duration: number;
  sample_count: number;
  joint_count: number;
  max_velocity: number[];
  mean_velocity: number[];
  path_length: number;
  recording_source: string;
  status: string;
}

export interface ReplayRequest {
  session_id: number;
  interpolation?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  listSessions(): Observable<SessionResponse[]> {
    return this.http.get<SessionResponse[]>(`${this.baseUrl}/sessions`);
  }

  getSession(id: number): Observable<SessionResponse> {
    return this.http.get<SessionResponse>(`${this.baseUrl}/sessions/${id}`);
  }

  getTrace(id: number): Observable<TraceData> {
    return this.http.get<TraceData>(`${this.baseUrl}/sessions/${id}/trace`);
  }

  getSessionSummary(id: number): Observable<SessionSummary> {
    return this.http.get<SessionSummary>(`${this.baseUrl}/sessions/${id}/summary`);
  }

  exportCsv(id: number): Observable<string> {
    return this.http.get(`${this.baseUrl}/sessions/${id}/export`, { responseType: 'text' });
  }

  startReplay(sessionId: number, interpolation?: string): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(`${this.baseUrl}/sessions/${sessionId}/replay`, {
      session_id: sessionId,
      interpolation: interpolation ?? 'linear',
    } satisfies ReplayRequest);
  }

  importTrace(traceJson: string, robotName?: string): Observable<SessionResponse> {
    return this.http.post<SessionResponse>(`${this.baseUrl}/sessions/import`, {
      trace_json: traceJson,
      robot_name: robotName ?? 'imported',
    } satisfies ImportRequest);
  }

  seekExecution(position: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/scene/motion/seek`, { position });
  }
}
