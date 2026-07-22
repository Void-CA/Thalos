import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { SessionApiService, type SessionResponse, type SessionComparisonResponse, type ExecutionStatisticsDto, type ExecutionTraceDto } from '../../api/session-api.service';
import { ReplayStore } from '../../store/replay.store';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { PerspectiveStore } from '../../store/perspective.store';
import { TracePreview } from '../../charts/components/trace-preview/trace-preview';
import { ComparisonChart } from '../../charts/components/comparison-chart/comparison-chart';

type StatusFilter = 'all' | 'completed' | 'failed' | 'running';

interface SessionDetail {
  session: SessionResponse;
  statistics: ExecutionStatisticsDto | null;
  comparison: SessionComparisonResponse | null;
  statsLoading: boolean;
  comparisonLoading: boolean;
}

/**
 * Session Browser — master-detail para inspección de ejecuciones.
 */
@Component({
  selector: 'session-browser',
  standalone: true,
  imports: [NgIcon, TracePreview, ComparisonChart],
  templateUrl: './session-browser.html',
  styleUrl: './session-browser.scss',
})
export class SessionBrowser {
  private readonly api = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);
  private readonly scene = inject(SceneStore);
  private readonly perspective = inject(PerspectiveStore);

  // ── Filters ──

  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly searchTerm = signal('');

  // ── Data ──

  protected readonly sessions = signal<SessionResponse[]>([]);
  protected readonly listLoading = signal(true);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly replaying = signal(false);

  // ── Detail ──

  protected readonly detail = signal<SessionDetail | null>(null);
  protected readonly detailTab = signal<'overview' | 'trace' | 'comparison'>('overview');
  protected readonly traceData = signal<ExecutionTraceDto | null>(null);
  protected readonly traceLoading = signal(false);

  // ── Filtered list ──

  protected readonly filteredSessions = computed(() => {
    let list = this.sessions();
    const filter = this.statusFilter();
    const search = this.searchTerm().toLowerCase().trim();

    if (filter === 'completed') list = list.filter(s => s.status === 'Completed');
    else if (filter === 'failed') list = list.filter(s => s.status === 'Failed' || s.status === 'Cancelled');
    else if (filter === 'running') list = list.filter(s => s.status !== 'Completed' && s.status !== 'Failed' && s.status !== 'Cancelled');

    if (search) {
      list = list.filter(s =>
        s.plan_id.toLowerCase().includes(search) ||
        s.robot_name.toLowerCase().includes(search)
      );
    }

    return list.sort((a, b) => b.id - a.id);
  });

  // ── Lifecycle ──

  constructor() {
    this.loadSessions();
  }

  private loadSessions(): void {
    this.listLoading.set(true);
    this.api.listSessions().subscribe({
      next: (list) => { this.sessions.set(list); this.listLoading.set(false); },
      error: () => this.listLoading.set(false),
    });
  }

  // ── Actions ──

  protected select(id: number): void {
    this.selectedId.set(id);
    this.loadDetail(id);
  }

  private loadDetail(id: number): void {
    const session = this.sessions().find(s => s.id === id);
    if (!session) return;

    this.detail.set({
      session,
      statistics: null,
      comparison: null,
      statsLoading: true,
      comparisonLoading: false,
    });

    this.api.getExecutionStatistics(id).subscribe({
      next: (stats) => this.detail.update(d => d ? { ...d, statistics: stats, statsLoading: false } : d),
      error: () => this.detail.update(d => d ? { ...d, statsLoading: false } : d),
    });
  }

  protected switchTab(tab: 'overview' | 'trace' | 'comparison'): void {
    this.detailTab.set(tab);
    const id = this.selectedId();
    if (tab === 'trace' && id !== null && this.traceData() === null) {
      this.loadTrace(id);
    }
    if (tab === 'comparison' && id !== null && !this.detail()?.comparison) {
      this.loadComparison(id);
    }
  }

  private loadTrace(id: number): void {
    this.traceLoading.set(true);
    this.api.getExecutionTrace(id).subscribe({
      next: (t) => { this.traceData.set(t); this.traceLoading.set(false); },
      error: () => this.traceLoading.set(false),
    });
  }

  protected loadComparison(id: number): void {
    this.detail.update(d => d ? { ...d, comparisonLoading: true } : d);
    this.api.getComparison(id).subscribe({
      next: (cmp) => this.detail.update(d => d ? { ...d, comparison: cmp, comparisonLoading: false } : d),
      error: () => this.detail.update(d => d ? { ...d, comparisonLoading: false } : d),
    });
  }

  protected onReplay(id: number): void {
    this.replaying.set(true);
    this.api.startReplay(id).subscribe({
      next: (res) => {
        this.replaying.set(false);
        this.scene.applySnapshot(res);
        this.replayStore.startReplay(id);
      },
      error: () => this.replaying.set(false),
    });
  }

  protected onExport(id: number): void {
    this.api.exportCsv(id).subscribe({
      next: (csv) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `thalos-session-${id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  protected viewInKnowledge(sessionId: number): void {
    // TODO M8.4.4: cargar análisis de la sesión en Knowledge Workspace
    this.perspective.setPerspective('knowledge');
  }

  // ── Template helpers ──

  protected onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected setFilter(f: string): void {
    this.statusFilter.set(f as StatusFilter);
  }

  // ── Computed chart data ──

  protected readonly comparisonChartData = computed(() => {
    const cmp = this.detail()?.comparison;
    if (!cmp) return null;
    return {
      rmse: cmp.metrics.global_rmse,
      maxError: cmp.metrics.global_max_error,
      alignedCount: cmp.aligned_pair_count,
      pairedErrors: cmp.aligned_pair_count > 0 ? [cmp.metrics.global_rmse] : undefined,
    };
  });

  // ── Template helpers ──

  protected formatTime(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  protected statusClass(status: string): string {
    switch (status) {
      case 'Completed': return 'badge--completed';
      case 'Failed': case 'Cancelled': return 'badge--failed';
      case 'Active': case 'Running': return 'badge--running';
      default: return 'badge--ready';
    }
  }

  protected isActive(status: string): boolean {
    return status !== 'Completed' && status !== 'Failed' && status !== 'Cancelled';
  }
}
