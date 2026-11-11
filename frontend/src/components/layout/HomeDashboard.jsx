import React, { useState } from 'react';
import {
  Film,
  Layers,
  Activity,
  Download,
  Home,
  ArrowRight,
  CheckCircle2,
  Clock,
  Mic,
  Music,
} from 'lucide-react';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import './HomeDashboard.css';

const STUDIO_WORKSPACES = [
  {
    path: '/studio',
    title: 'Studio Editor',
    khmerTitle: 'ផ្ទាំងកាត់ត & Timeline',
    desc: 'កាត់តវីដេអូ, កែសម្រួលប្រយោគខ្មែរ, សំឡេង AI និង Multi-Track Timeline',
    icon: Film,
    iconColorClass: 'home-icon-cyan',
    badgeText: 'NLE Studio',
  },
  {
    path: '/batch',
    title: 'Batch Studio',
    khmerTitle: 'ផលិតច្រើនភាគព្រមគ្នា',
    desc: 'កំណត់ទម្រង់ Script Setup រួម + Translate + សំឡេង AI + Demucs Clean BGM',
    icon: Layers,
    iconColorClass: 'home-icon-amber',
    badgeText: 'Multi-EP Queue',
  },
  {
    path: '/quota',
    title: 'Keys & Quota',
    khmerTitle: 'គ្រប់គ្រង API Keys Pool',
    desc: 'ត្រួតពិនិត្យសុខភាព API Keys ទាំង ៦, RPM/TPM/RPD Quota និង Rate Limits',
    icon: Activity,
    iconColorClass: 'home-icon-emerald',
    badgeText: 'Rate Limits',
  },
  {
    path: '/export',
    title: 'Export Studio',
    khmerTitle: 'បញ្ចេញវីដេអូសម្រេច',
    desc: 'Render វីដេអូ 16:9 ឬ 9:16 ច្រើនភាគព្រមគ្នា និងបញ្ចូលគ្រប់ភាគជាវីដេអូពេញ ១ រឿង',
    icon: Download,
    iconColorClass: 'home-icon-sky',
    badgeText: 'FFmpeg Render',
  },
];

function formatSeriesDisplayTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return 'DragonDub Drama Series';
  let t = rawTitle.trim();
  if (isCorruptedOrMojibakeTitle(t)) return 'DragonDub Drama Series';
  // Strip trailing hash/BV tags like " p01 1 [BV1LuH..."
  t = t.replace(/\s+p\d+.*$/i, '');
  t = t.replace(/\s*\[BV[a-zA-Z0-9]+.*$/i, '');
  // If title is a long Chinese synopsis, cut at first major punctuation
  if (t.length > 55) {
    const commaIdx = t.indexOf('，');
    if (commaIdx > 8 && commaIdx < 45) {
      t = t.slice(0, commaIdx);
    } else {
      t = t.slice(0, 50) + '...';
    }
  }
  return t || 'DragonDub Drama Series';
}

function formatEpisodeDisplayTitle(ep, idx) {
  const epNum = ep?.episodeNumber || idx + 1;
  const raw = (ep?.title || ep?.displayTitle || '').trim();
  if (!raw || isCorruptedOrMojibakeTitle(raw)) {
    return `ភាគទី ${epNum}`;
  }
  // Strip duplicate repetitive prefix: "ភាគទី 1: ភាគទី 1" -> "ភាគទី 1"
  const cleaned = raw.replace(/^ភាគទី\s*\d+\s*:\s*/i, '');
  return cleaned || `ភាគទី ${epNum}`;
}

export default function HomeDashboard({
  activeSeries = null,
  activeEpisode = null,
  episodeId = null,
  onNavigateRoute = null,
  onSwitchEpisode = null,
  onTabChange = null,
}) {
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'translated' | 'pending'

  const episodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];
  const totalEps = episodes.length;

  const translatedCount = episodes.filter((ep) => {
    const segs = ep?.scriptData?.segments || [];
    return segs.length > 0 && segs.some((s) => Boolean((s.khmerText || s.khmer || '').trim()));
  }).length;

  const ttsCount = episodes.filter((ep) => {
    const segs = ep?.scriptData?.segments || [];
    return Boolean(ep?.audioGenerated || ep?.fullAudioUrl || (segs.length > 0 && segs.some((s) => Boolean(s.audioUrl))));
  }).length;

  const demucsCount = episodes.filter((ep) => {
    return Boolean(ep?.hasCleanBgm || ep?.cleanBgmUrl || ep?.instrumentalPath || ep?.cleanBgmPath);
  }).length;

  const renderedCount = episodes.filter((ep) => {
    return Boolean(ep?.renderedVideo?.url || ep?.renderedVideoUrl || ep?.status === 'rendered');
  }).length;

  const overallProgressPct = totalEps > 0 ? Math.round((translatedCount / totalEps) * 100) : 0;
  const seriesDisplayTitle = formatSeriesDisplayTitle(activeSeries?.title);

  const filteredEpisodes = episodes.filter((ep) => {
    if (filterTab === 'translated') {
      const segs = ep?.scriptData?.segments || [];
      return segs.length > 0 && segs.some((s) => Boolean((s.khmerText || s.khmer || '').trim()));
    }
    if (filterTab === 'pending') {
      const segs = ep?.scriptData?.segments || [];
      return !segs.length || !segs.some((s) => Boolean((s.khmerText || s.khmer || '').trim()));
    }
    return true;
  });

  const handleGoToRoute = (routePath, tab = null) => {
    if (tab && onTabChange) {
      onTabChange(tab);
    }
    if (onNavigateRoute) {
      onNavigateRoute(routePath);
    }
  };

  const handleOpenEpisode = (epId) => {
    if (epId && onSwitchEpisode) {
      onSwitchEpisode(epId);
    }
    if (onNavigateRoute) {
      onNavigateRoute('/studio');
    }
  };

  return (
    <div data-testid="home-dashboard-view" className="home-dashboard-view">
      <div className="home-dashboard-inner">
        {/* 1. Project Hero Overview Card */}
        <section data-testid="home-dashboard-header" className="home-hero-card">
          <div className="home-hero-top">
            <div className="home-hero-title-group">
              <div className="home-hero-badge-icon" title="DragonDub AI Studio">
                <Home size={22} />
              </div>
              <div className="home-hero-headings">
                <div className="home-hero-eyebrow">
                  <span>DRAMA PRODUCTION DASHBOARD</span>
                  <span className="home-hero-eyebrow-sep">•</span>
                  <span>{totalEps} EPISODES</span>
                </div>
                <h1 className="home-hero-series-title" title={activeSeries?.title || ''}>
                  {seriesDisplayTitle}
                </h1>
              </div>
            </div>

            <button
              type="button"
              data-testid="btn-home-open-studio"
              onClick={() => handleGoToRoute('/studio')}
              className="home-hero-cta"
              title="ចូលផ្ទាំងកាត់ត (Open Studio — /studio)"
            >
              <Film size={15} />
              <span>ចូលផ្ទាំងកាត់ត (Open Studio)</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="home-hero-metrics-row">
            <div className="home-hero-progress-box">
              <div className="home-hero-progress-labels">
                <span>វឌ្ឍនភាពបកប្រែ Script សរុប ({translatedCount}/{totalEps} ភាគ)</span>
                <span className="home-hero-progress-pct">{overallProgressPct}%</span>
              </div>
              <div className="home-hero-progress-track">
                <div
                  className="home-hero-progress-fill"
                  style={{ width: `${Math.max(4, overallProgressPct)}%` }}
                />
              </div>
            </div>

            <div className="home-hero-stat-chips">
              <div className="home-stat-chip">
                <span>បកប្រែ៖</span>
                <span className="home-stat-chip-num">{translatedCount}/{totalEps}</span>
              </div>
              <div className="home-stat-chip">
                <span>សំឡេង AI៖</span>
                <span className="home-stat-chip-num">{ttsCount}/{totalEps}</span>
              </div>
              <div className="home-stat-chip">
                <span>Clean BGM៖</span>
                <span className="home-stat-chip-num">{demucsCount}/{totalEps}</span>
              </div>
              <div className="home-stat-chip">
                <span>Rendered៖</span>
                <span className="home-stat-chip-num">{renderedCount}/{totalEps}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Studio Workspaces (4-Column Clean Studio Cards) */}
        <section
          data-testid="home-route-directory"
          className="home-workspaces-grid"
          aria-label="Studio Workspaces"
        >
          {STUDIO_WORKSPACES.map((ws) => {
            const IconComp = ws.icon;
            const routeId = ws.path.replace('/', '');
            return (
              <div
                key={ws.path}
                data-testid={`home-route-row-${routeId}`}
                onClick={() => handleGoToRoute(ws.path)}
                className="home-workspace-card"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleGoToRoute(ws.path);
                  }
                }}
              >
                <div className="home-workspace-card-top">
                  <div className="home-workspace-header-row">
                    <div className={`home-workspace-icon-wrap ${ws.iconColorClass}`}>
                      <IconComp size={18} />
                    </div>
                    <span className="home-workspace-route-pill">{ws.path}</span>
                  </div>
                  <div>
                    <h2 className="home-workspace-title">{ws.title}</h2>
                    <p className="home-workspace-desc">{ws.desc}</p>
                  </div>
                </div>

                <div className="home-workspace-card-footer">
                  <span>{ws.khmerTitle}</span>
                  <ArrowRight size={14} className="home-workspace-arrow" />
                </div>
              </div>
            );
          })}
        </section>

        {/* 3. Production Episodes Table (Linear / NLE Style) */}
        <section data-testid="home-episodes-list" className="home-table-section">
          <div className="home-table-header">
            <div className="home-table-title-group">
              <Film size={15} className="text-cyan-400" />
              <span className="home-table-title">បញ្ជីភាគក្នុងរឿង (Episode Pipeline)</span>
              <span className="home-table-count-badge">{totalEps} ភាគ</span>
            </div>

            <div className="home-filter-tabs" role="tablist">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`home-filter-btn ${filterTab === 'all' ? 'active' : ''}`}
              >
                ទាំងអស់ ({totalEps})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('translated')}
                className={`home-filter-btn ${filterTab === 'translated' ? 'active' : ''}`}
              >
                បានបកប្រែ ({translatedCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('pending')}
                className={`home-filter-btn ${filterTab === 'pending' ? 'active' : ''}`}
              >
                នៅសល់ ({totalEps - translatedCount})
              </button>
            </div>
          </div>

          <div className="home-table-cols-head">
            <span>ភាគ</span>
            <span>ចំណងជើង</span>
            <span className="home-col-segments">ចំនួនឃ្លា</span>
            <span>ដំណាក់កាល PIPELINE</span>
            <span style={{ textAlign: 'right' }}>សកម្មភាព</span>
          </div>

          <div className="home-episodes-table-body">
            {filteredEpisodes.length === 0 ? (
              <div className="home-episodes-empty">
                មិនមានភាគនៅក្នុង Filter នេះទេ
              </div>
            ) : (
              filteredEpisodes.map((ep, idx) => {
                const segs = ep?.scriptData?.segments || [];
                const hasScript = segs.length > 0 && segs.some((s) => Boolean((s.khmerText || s.khmer || '').trim()));
                const hasTts = Boolean(
                  ep?.audioGenerated || ep?.fullAudioUrl || (segs.length > 0 && segs.some((s) => Boolean(s.audioUrl)))
                );
                const hasDemucs = Boolean(
                  ep?.hasCleanBgm || ep?.cleanBgmUrl || ep?.instrumentalPath || ep?.cleanBgmPath
                );
                const isCurrent = ep.id === (activeEpisode?.id || episodeId);
                const epNum = ep.episodeNumber || idx + 1;
                const cleanTitle = formatEpisodeDisplayTitle(ep, idx);

                return (
                  <div
                    key={ep.id || idx}
                    onClick={() => handleOpenEpisode(ep.id)}
                    className={`home-table-row ${isCurrent ? 'is-current' : ''}`}
                    title="ចុចដើម្បីបើកភាគនេះក្នុង Studio"
                  >
                    <div>
                      <span className="home-ep-pill-badge">EP {String(epNum).padStart(2, '0')}</span>
                    </div>

                    <div className="home-ep-title-cell">
                      {cleanTitle}
                    </div>

                    <div className="home-ep-lines-cell home-col-segments">
                      {segs.length > 0 ? `${segs.length} ឃ្លា` : '—'}
                    </div>

                    <div className="home-pipeline-status-cell">
                      <span className={`home-pipe-indicator ${hasScript ? 'done-script' : 'pending'}`}>
                        {hasScript ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                        <span>Script</span>
                      </span>

                      <span className={`home-pipe-indicator ${hasTts ? 'done-tts' : 'pending'}`}>
                        <Mic size={11} />
                        <span>Voice AI</span>
                      </span>

                      <span className={`home-pipe-indicator ${hasDemucs ? 'done-bgm' : 'pending'}`}>
                        <Music size={11} />
                        <span>BGM</span>
                      </span>
                    </div>

                    <div className="home-ep-action-cell">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEpisode(ep.id);
                        }}
                        className="home-open-row-btn"
                      >
                        <span>កាត់ត</span>
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
