import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';

type BannerState = 'good' | 'attention' | 'critical';

/**
 * Status Banner — barra de estado horizontal que reemplaza al Health Score card.
 *
 * Comunica el estado del plan en este orden:
 *   1. Estado (GOOD / ATTENTION / CRITICAL) — color + palabra
 *   2. Score (84 / 100) — número secundario
 *   3. Resumen en lenguaje natural
 *   4. Severity distribution compacta (✗ 3 ⚠ 8 ℹ 12)
 */
@Component({
  selector: 'status-banner',
  standalone: true,
  imports: [NgIcon],
  template: `
    <div class="sb" [class]="'sb sb--' + bannerState()">
      <div class="sb__main">
        <span class="sb__indicator"></span>
        <span class="sb__state">{{ stateLabel() }}</span>
        <span class="sb__score">{{ summary()?.score ?? '—' }} / 100</span>
        <span class="sb__message">{{ summary()?.message ?? '' }}</span>
      </div>
      @if (totalFindings() > 0) {
        <div class="sb__severity">
          @if (errorCount() > 0) {
            <span class="sb__sev sb__sev--error">
              <ng-icon name="heroXMark" size="14" /> {{ errorCount() }}
            </span>
          }
          @if (warnCount() > 0) {
            <span class="sb__sev sb__sev--warn">
              <ng-icon name="heroExclamationTriangle" size="14" /> {{ warnCount() }}
            </span>
          }
          @if (infoCount() > 0) {
            <span class="sb__sev sb__sev--info">
              <ng-icon name="heroInformationCircle" size="14" /> {{ infoCount() }}
            </span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sb {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.25rem;
      padding: 0.875rem 1.25rem;
      border-radius: 6px;
      border-left: 5px solid transparent;
      font-family: inherit;
    }
    .sb__main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .sb__indicator {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .sb__state {
      font-weight: 800;
      font-size: 1.125rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sb__score {
      font-size: 0.9375rem;
      font-weight: 600;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }
    .sb__message {
      font-size: 0.9375rem;
      opacity: 0.55;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sb__severity {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-shrink: 0;
    }
    .sb__sev {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.875rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .sb__sev--error { color: #b85450; }
    .sb__sev--warn  { color: #b8943a; }
    .sb__sev--info  { color: #4a7a9a; }

    /* GOOD — verde */
    .sb--good {
      background: rgba(#4a9e5a, 0.08);
      border-left-color: #4a9e5a;
    }
    .sb--good .sb__indicator { background: #4a9e5a; }
    .sb--good .sb__state { color: #4a9e5a; }

    /* ATTENTION — ámbar */
    .sb--attention {
      background: rgba(#b8943a, 0.08);
      border-left-color: #b8943a;
    }
    .sb--attention .sb__indicator { background: #b8943a; }
    .sb--attention .sb__state { color: #b8943a; }

    /* CRITICAL — rojo */
    .sb--critical {
      background: rgba(#b85450, 0.08);
      border-left-color: #b85450;
    }
    .sb--critical .sb__indicator { background: #b85450; }
    .sb--critical .sb__state { color: #b85450; }
  `],
})
export class StatusBanner {
  private readonly pa = inject(PlanAnalysisStore);

  protected readonly summary = this.pa.summary;
  protected readonly findings = this.pa.findings;

  protected readonly bannerState = computed<BannerState>(() => {
    const status = this.summary()?.status;
    if (status === 'error') return 'critical';
    if (status === 'warning') return 'attention';
    return 'good';
  });

  protected readonly stateLabel = computed(() => {
    const status = this.summary()?.status;
    if (status === 'error') return 'Critical';
    if (status === 'warning') return 'Attention';
    return 'Good';
  });

  protected readonly totalFindings = computed(() => this.findings().length);

  protected readonly errorCount = computed(() =>
    this.findings().filter(f => f.severity === 'error').length,
  );

  protected readonly warnCount = computed(() =>
    this.findings().filter(f => f.severity === 'warning').length,
  );

  protected readonly infoCount = computed(() =>
    this.findings().filter(f => f.severity === 'info').length,
  );
}
