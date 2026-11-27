import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Film,
  Layers,
  Activity,
  Download,
  ArrowRight,
  ArrowLeft,
  Check,
  Clock,
  Zap,
  Search,
  LayoutGrid,
  List,
  CheckCircle2,
  AlertTriangle,
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  Edit2,
  Trash2,
  X,
} from 'lucide-react';
import { uploadVideoFile } from '../../services/api';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import { formatTimecode } from '../../utils/timestampUtils';
import {
  checkEpisodeHasScript,
  checkEpisodeHasAudioReady,
  checkEpisodeHasDemucsReady,
  checkEpisodeHasAutoFitReady,
  getEpisodeBrokenSummary,
  getEpisodeSegmentCount,
} from '../dashboard/geminiRouteHelpers';
import './HomeDashboard.css';

const STUDIO_WORKSPACES = [
  {
    path: '/studio',
    title: 'Studio Editor',
    khmerSub: 'កាត់តវីដេអូ · Subtitle · Timeline',
    icon: Film,
    accentClass: 'ws-cyan',
  },
  {
    path: '/batch',
    title: 'Batch Studio',
    khmerSub: 'ផលិតច្រើនភាគ · Script · Voice · BGM',
    icon: Layers,
    accentClass: 'ws-amber',
  },
  {
    path: '/quota',
    title: 'Keys & Quota',
    khmerSub: 'ត្រួតពិនិត្យ API Keys Pool & RPM',
    icon: Activity,
    accentClass: 'ws-emerald',
  },
  {
    path: '/export',
    title: 'Export Studio',
    khmerSub: 'Render MP4 ច្រើនភាគ & បូកជារឿងពេញ',
    icon: Download,
    accentClass: 'ws-sky',
  },
];

function formatSeriesDisplayTitle(rawTitle, fallbackId = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return fallbackId || 'DragonDub Drama Series';
  let t = rawTitle.trim();
  if (isCorruptedOrMojibakeTitle(t)) return fallbackId || 'DragonDub Drama Series';
  t = t.replace(/\s+p\d+.*$/i, '').replace(/\s*\[BV[a-zA-Z0-9]+.*$/i, '');
  if (t.length > 55) {
    const commaIdx = t.indexOf('，');
    t = commaIdx > 8 && commaIdx < 45 ? t.slice(0, commaIdx) : `${t.slice(0, 50)}...`;
  }
  return t || fallbackId || 'DragonDub Drama Series';
}

function formatEpisodeDisplayTitle(ep, idx) {
  const epNum = ep?.episodeNumber || idx + 1;
  const raw = (ep?.title || ep?.displayTitle || '').trim();
  if (!raw || isCorruptedOrMojibakeTitle(raw)) {
    return `ភាគទី ${epNum}`;
  }
  const cleaned = raw.replace(/^ភាគទី\s*(\d+)\s*:\s*(?=ភាគទី\s*\1\b)/i, '').replace(/^ភាគទី\s*\d+\s*:\s*/i, '');
  return cleaned || `ភាគទី ${epNum}`;
}

function checkEpisodeRendered(ep) {
  return Boolean(
    ep?.renderedVideo?.outputVideoUrl ||
    ep?.renderedVideo?.videoUrl ||
    ep?.renderedVideo?.url ||
    ep?.renderedVideoUrl ||
    ep?.status === 'rendered'
  );
}

function computeSeriesMetrics(seriesObj) {
  const episodes = Array.isArray(seriesObj?.episodes) ? seriesObj.episodes : [];
  const totalEps = episodes.length;
  let scripted = 0;
  let voiced = 0;
  let autofitted = 0;
  let cleanBgm = 0;
  let rendered = 0;
  let ready124 = 0;
  let brokenEps = 0;

  const rows = episodes.map((ep, idx) => {
    const epNum = ep?.episodeNumber || idx + 1;
    const segCount = getEpisodeSegmentCount(ep);
    const broken = getEpisodeBrokenSummary(ep);
    const hasScript = checkEpisodeHasScript(ep) && (broken?.textBrokenCount || 0) === 0;
    const hasVoice = checkEpisodeHasAudioReady(ep, null, null) && !ep?.audioOutdated;
    const hasAutoFit = Boolean(hasVoice && checkEpisodeHasAutoFitReady(ep));
    const hasBgm = checkEpisodeHasDemucsReady(ep, null, null);
    const hasRender = checkEpisodeRendered(ep);
    const isCoreReady = Boolean(hasScript && hasVoice && hasBgm);
    const hasBrokenText = (broken?.textBrokenCount || 0) > 0;

    if (hasScript) scripted += 1;
    if (hasVoice) voiced += 1;
    if (hasAutoFit) autofitted += 1;
    if (hasBgm) cleanBgm += 1;
    if (hasRender) rendered += 1;
    if (isCoreReady) ready124 += 1;
    if (hasBrokenText) brokenEps += 1;

    return {
      ep,
      idx,
      epNum,
      segCount,
      cleanTitle: formatEpisodeDisplayTitle(ep, idx),
      hasScript,
      hasVoice,
      hasAutoFit,
      hasBgm,
      hasRender,
      isCoreReady,
      brokenTextCount: broken?.textBrokenCount || 0,
    };
  });

  const readyPct = totalEps > 0 ? Math.round((ready124 / totalEps) * 100) : 0;

  return {
    rows,
    totalEps,
    scripted,
    voiced,
    autofitted,
    cleanBgm,
    rendered,
    ready124,
    readyPct,
    incomplete124: Math.max(0, totalEps - ready124),
    autofitTodo: Math.max(0, totalEps - autofitted),
    brokenEps,
  };
}

export default function HomeDashboard({
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onNavigateRoute = null,
  onSwitchSeries = null,
  onSwitchEpisode = null,
  onRenameSeries = null,
  onDeleteSeries = null,
  onRefreshSeries = null,
  onRefreshAllSeries = null,
  onTabChange = null,
}) {
  // Default to Folder View (null = show Series Folders; string = opened Series Folder ID showing episodes inside)
  const [openedFolderId, setOpenedFolderId] = useState(null);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'ready' | 'incomplete' | 'autofit_todo' | 'rendered'
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  // Inline Create New Folder, Rename Folder & Custom Delete Folder Modal state
  const [showNewFolderForm, setShowNewFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState(null);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [tempFolderTitle, setTempFolderTitle] = useState('');
  const [deleteTargetFolder, setDeleteTargetFolder] = useState(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [isUploadingFolder, setIsUploadingFolder] = useState(false);
  const [folderUploadProgress, setFolderUploadProgress] = useState(null);
  const folderUploadInputRef = useRef(null);

  // Always synchronize full series list from server truth on mount so folders created on disk (e.g. ss2) appear immediately
  useEffect(() => {
    let cancelled = false;
    fetch('/api/series')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.series)) {
          if (typeof onRefreshAllSeries === 'function') {
            onRefreshAllSeries(data.series);
          } else if (typeof onRefreshSeries === 'function') {
            onRefreshSeries();
          }
        }
      })
      .catch((err) => console.warn('[HomeDashboard] Server series sync notice:', err?.message));
    return () => { cancelled = true; };
  }, [onRefreshAllSeries, onRefreshSeries]);

  // Ensure we always have a clean array of series folders (including activeSeries even if seriesList is temporarily stale)
  const allSeriesFolders = useMemo(() => {
    let list = Array.isArray(seriesList) ? [...seriesList] : [];
    if (activeSeries && !list.some((s) => String(s.id) === String(activeSeries.id))) {
      list.push(activeSeries);
    }
    return list.filter(Boolean).map((s) => {
      const isCurrentActive = String(s.id) === String(activeSeries?.id || seriesId);
      // Merge activeSeries episodes if this is the active series (ensures freshest in-memory state)
      const resolvedSeries = isCurrentActive && activeSeries ? activeSeries : s;
      return {
        series: resolvedSeries,
        id: resolvedSeries.id,
        displayTitle: formatSeriesDisplayTitle(resolvedSeries.title, resolvedSeries.id),
        isCurrentActive,
        metrics: computeSeriesMetrics(resolvedSeries),
      };
    });
  }, [seriesList, activeSeries, seriesId]);

  // Sync openedFolderId when activeSeries changes so the opened view matches the current series
  useEffect(() => {
    if (activeSeries?.id && openedFolderId && String(openedFolderId) !== String(activeSeries.id)) {
      setOpenedFolderId(activeSeries.id);
    }
  }, [activeSeries?.id]);

  const activeFolderSummary = useMemo(() => {
    return (
      allSeriesFolders.find((f) => f.isCurrentActive) ||
      allSeriesFolders[0] || {
        series: activeSeries,
        id: activeSeries?.id || 'default',
        displayTitle: formatSeriesDisplayTitle(activeSeries?.title),
        isCurrentActive: true,
        metrics: computeSeriesMetrics(activeSeries),
      }
    );
  }, [allSeriesFolders, activeSeries]);

  const openedFolderSummary = useMemo(() => {
    if (!openedFolderId) return null;
    return allSeriesFolders.find((f) => String(f.id) === String(openedFolderId)) || null;
  }, [allSeriesFolders, openedFolderId]);

  const activeMetrics = activeFolderSummary.metrics;
  const totalEps = activeMetrics.totalEps;
  const overallReadyPct = activeMetrics.readyPct;
  const seriesDisplayTitle = activeFolderSummary.displayTitle;

  // Filtered Series Folders when in root Folder Explorer view
  const filteredFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSeriesFolders;
    return allSeriesFolders.filter((f) =>
      f.displayTitle.toLowerCase().includes(q) || String(f.id).toLowerCase().includes(q)
    );
  }, [allSeriesFolders, searchQuery]);

  // Filtered Episodes when inside an opened Series Folder
  const openedMetrics = openedFolderSummary ? openedFolderSummary.metrics : activeMetrics;
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return openedMetrics.rows.filter((item) => {
      if (filterTab === 'ready' && !item.isCoreReady) return false;
      if (filterTab === 'incomplete' && item.isCoreReady) return false;
      if (filterTab === 'autofit_todo' && item.hasAutoFit) return false;
      if (filterTab === 'rendered' && !item.hasRender) return false;
      if (q) {
        const matchNum = `ep${item.epNum}`.includes(q) || `ep ${item.epNum}`.includes(q) || String(item.epNum) === q;
        const matchTitle = item.cleanTitle.toLowerCase().includes(q);
        if (!matchNum && !matchTitle) return false;
      }
      return true;
    });
  }, [openedMetrics.rows, filterTab, searchQuery]);

  const handleGoToRoute = (routePath, tab = null) => {
    if (tab && onTabChange) onTabChange(tab);
    if (onNavigateRoute) onNavigateRoute(routePath);
  };

  const handleOpenFolder = async (folderId) => {
    if (!folderId) return;
    setOpenedFolderId(folderId);
    setSearchQuery('');
    setFilterTab('all');
    if (String(folderId) !== String(activeSeries?.id || seriesId) && typeof onSwitchSeries === 'function') {
      await onSwitchSeries(folderId);
    }
  };

  const handleBackToFolders = () => {
    setOpenedFolderId(null);
    setSearchQuery('');
    setFilterTab('all');
  };

  const handleOpenEpisode = async (epId, parentSeriesId = null) => {
    const targetSeriesId = parentSeriesId || openedFolderSummary?.id || activeSeries?.id;
    if (targetSeriesId && String(targetSeriesId) !== String(activeSeries?.id || seriesId) && typeof onSwitchSeries === 'function') {
      await onSwitchSeries(targetSeriesId);
    }
    if (epId && onSwitchEpisode) onSwitchEpisode(epId);
    if (onNavigateRoute) onNavigateRoute('/studio');
  };

  const handleCreateNewFolder = async (e) => {
    if (e) e.preventDefault();
    const cleanTitle = (newFolderName || '').trim();
    if (!cleanTitle) {
      setCreateFolderError('សូមបញ្ចូលឈ្មោះ Folder រឿងថ្មី!');
      return;
    }
    const exists = allSeriesFolders.some(
      (f) =>
        f.displayTitle.toLowerCase() === cleanTitle.toLowerCase() ||
        String(f.id).toLowerCase() === cleanTitle.toLowerCase()
    );
    if (exists) {
      setCreateFolderError('Folder រឿងនេះមានរួចហើយ! សូមដាក់ឈ្មោះផ្សេង។');
      return;
    }

    try {
      setIsCreatingFolder(true);
      setCreateFolderError(null);
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            title: cleanTitle,
            createdAt: Date.now(),
            episodes: [],
            glossary: { characters: [], terms: [] },
            cast: [],
          },
        }),
      });
      const data = await res.json();
      if (!data?.success || !data?.series?.id) {
        throw new Error(data?.error || 'មិនអាចបង្កើត Folder រឿងបានទេ');
      }

      const createdSeriesId = data.series.id;
      setShowNewFolderForm(false);
      setNewFolderName('');

      if (typeof onSwitchSeries === 'function') {
        await onSwitchSeries(createdSeriesId);
      } else if (typeof onRefreshSeries === 'function') {
        await onRefreshSeries();
      }
      setOpenedFolderId(createdSeriesId);
    } catch (err) {
      setCreateFolderError(err?.message || 'មិនអាចបង្កើត Folder រឿងបានទេ');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleUploadVideoFolder = async (e) => {
    const rawFiles = Array.from(e?.target?.files || []);
    if (e?.target) {
      e.target.value = '';
    }
    if (rawFiles.length === 0) return;

    const validExtensions = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.ts', '.flv', '.wmv'];
    const videoFiles = rawFiles.filter((file) => {
      const name = String(file?.name || '').toLowerCase();
      const dotIdx = name.lastIndexOf('.');
      const ext = dotIdx >= 0 ? name.slice(dotIdx) : '';
      return file?.type?.startsWith('video/') || validExtensions.includes(ext);
    });

    if (videoFiles.length === 0) {
      setCreateFolderError('Folder ដែលបានជ្រើសរើសមិនមាន file វីដេអូទេ! (គាំទ្រ MP4, MOV, MKV, WEBM, AVI)');
      return;
    }

    const firstRel = String(videoFiles[0]?.webkitRelativePath || '');
    const folderName = (firstRel.includes('/') ? firstRel.split('/')[0] : '').trim() || 'រឿងភាគថ្មី';

    const exists = allSeriesFolders.some(
      (f) =>
        f.displayTitle.toLowerCase() === folderName.toLowerCase() ||
        String(f.id).toLowerCase() === folderName.toLowerCase()
    );
    if (exists) {
      setCreateFolderError(`Folder "${folderName}" មានរួចហើយ! សូមដូរឈ្មោះ Folder ឬលុប Folder ចាស់សិន។`);
      return;
    }

    const sortedVideos = [...videoFiles].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );

    let createdSeriesId = null;
    let createdSeriesObj = null;
    const uploadedEpisodes = [];

    try {
      setIsUploadingFolder(true);
      setCreateFolderError(null);
      setFolderUploadProgress({
        current: 0,
        total: sortedVideos.length,
        folderName,
        fileName: 'កំពុងបង្កើត Folder រឿង...',
      });

      const createRes = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            title: folderName,
            createdAt: Date.now(),
            episodes: [],
            glossary: { characters: [], terms: [] },
            cast: [],
          },
        }),
      });
      const createData = await createRes.json();
      if (!createData?.success || !createData?.series?.id) {
        throw new Error(createData?.error || 'មិនអាចបង្កើត Folder រឿងបានទេ');
      }

      createdSeriesObj = createData.series;
      createdSeriesId = createData.series.id;
      const encodedSeriesId = encodeURIComponent(createdSeriesId);

      for (let i = 0; i < sortedVideos.length; i++) {
        const file = sortedVideos[i];
        const epNum = i + 1;
        const epTitle = `ភាគទី ${epNum} (EP${epNum})`;

        setFolderUploadProgress({
          current: epNum,
          total: sortedVideos.length,
          folderName,
          fileName: file.name,
        });

        const epRes = await fetch(`/api/series/${encodedSeriesId}/episodes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customTitle: epTitle,
            requestedNumber: epNum,
          }),
        });
        const epData = await epRes.json();
        if (!epRes.ok || !epData?.success) {
          throw new Error(epData?.error || `មិនអាចបង្កើតភាគទី ${epNum} បានទេ`);
        }

        const createdEp = epData?.episode || {
          id: `ep_${epNum}`,
          episodeNumber: epNum,
          title: epTitle,
        };

        const vidObj = await uploadVideoFile(file, {
          seriesId: createdSeriesId,
          episodeId: createdEp.id,
          projectName: createdSeriesId,
          displayTitle: epTitle,
        });

        uploadedEpisodes.push({
          ...createdEp,
          video: vidObj,
          videoFile: vidObj.videoId || vidObj.videoPath,
          duration: vidObj.durationSec || 0,
          status: 'uploaded',
        });
      }

      await fetch(`/api/series/${encodedSeriesId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            ...createdSeriesObj,
            id: createdSeriesId,
            title: createdSeriesObj.title || folderName,
            episodes: uploadedEpisodes,
          },
        }),
      });

      if (typeof onSwitchSeries === 'function') {
        await onSwitchSeries(createdSeriesId);
      } else if (typeof onRefreshSeries === 'function') {
        await onRefreshSeries();
      }
      setOpenedFolderId(createdSeriesId);
    } catch (err) {
      if (createdSeriesId && uploadedEpisodes.length > 0) {
        try {
          await fetch(`/api/series/${encodeURIComponent(createdSeriesId)}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              series: {
                ...(createdSeriesObj || {}),
                id: createdSeriesId,
                title: createdSeriesObj?.title || folderName,
                episodes: uploadedEpisodes,
              },
            }),
          });
          if (typeof onRefreshSeries === 'function') {
            await onRefreshSeries();
          }
        } catch (_) {}
      }
      setCreateFolderError(err?.message || 'មានបញ្ហាក្នុងការ Upload Folder វីដេអូ');
    } finally {
      setIsUploadingFolder(false);
      setFolderUploadProgress(null);
    }
  };

  const handleStartRenameFolder = (e, folderItem) => {
    e.stopPropagation();
    setEditingFolderId(folderItem.id);
    setTempFolderTitle(folderItem.series?.title || folderItem.displayTitle || '');
  };

  const handleSaveRenameFolder = async (e, folderId) => {
    if (e) e.stopPropagation();
    const clean = tempFolderTitle.trim();
    if (clean && typeof onRenameSeries === 'function') {
      const res = await onRenameSeries(clean, folderId);
      if (res && res.success === false && res.error) {
        setCreateFolderError(res.error);
        return;
      }
      setCreateFolderError(null);
      if (res?.newSeriesId && String(openedFolderId) === String(folderId)) {
        setOpenedFolderId(res.newSeriesId);
      }
    }
    setEditingFolderId(null);
  };

  const handleDeleteFolder = (e, folderItem) => {
    e.stopPropagation();
    if (!onDeleteSeries || !folderItem) return;
    setDeleteTargetFolder(folderItem);
  };

  const handleConfirmDeleteFolder = useCallback(async () => {
    if (!deleteTargetFolder || !onDeleteSeries) return;
    try {
      setIsDeletingFolder(true);
      const targetId = deleteTargetFolder.id;
      if (String(openedFolderId) === String(targetId)) {
        setOpenedFolderId(null);
      }
      await onDeleteSeries(targetId);
      setDeleteTargetFolder(null);
    } finally {
      setIsDeletingFolder(false);
    }
  }, [deleteTargetFolder, onDeleteSeries, openedFolderId]);

  const confirmDeleteBtnRef = useRef(null);

  // Keyboard shortcut: Press Enter / NumpadEnter to confirm delete, Escape to cancel
  useEffect(() => {
    if (!deleteTargetFolder) return;

    const timer = setTimeout(() => {
      confirmDeleteBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        if (!isDeletingFolder) {
          handleConfirmDeleteFolder();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!isDeletingFolder) {
          setDeleteTargetFolder(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [deleteTargetFolder, isDeletingFolder, handleConfirmDeleteFolder]);

  return (
    <div data-testid="home-dashboard-view" className="home-dashboard-view">
      <div className="home-dashboard-inner">
        {/* 1. Compact Workstation Project Bar */}
        <section data-testid="home-dashboard-header" className="home-project-bar">
          <div className="home-project-top">
            <div className="home-project-identity">
              <span className="home-project-tag">ACTIVE FOLDER</span>
              <h1 className="home-project-title" title={activeSeries?.title || ''}>
                {seriesDisplayTitle}
              </h1>
              <span className="home-project-ep-count">{totalEps} ភាគ</span>
              <span className={`home-project-ready-pill ${overallReadyPct === 100 && totalEps > 0 ? 'is-complete' : ''}`}>
                {overallReadyPct}% រួចរាល់ (1·2·4)
              </span>
            </div>

            <div className="home-project-actions">
              <button
                type="button"
                onClick={() => handleGoToRoute('/batch')}
                className="home-btn-secondary"
                title="បើក Batch Studio (/batch)"
              >
                <Layers size={14} />
                <span>Batch Studio</span>
              </button>
              <button
                type="button"
                data-testid="btn-home-open-studio"
                onClick={() => handleGoToRoute('/studio')}
                className="home-btn-primary"
                title="ចូលផ្ទាំងកាត់ត (Open Studio — /studio)"
              >
                <Film size={14} />
                <span>
                  {activeEpisode?.episodeNumber
                    ? `បន្តកាត់ត EP ${activeEpisode.episodeNumber}`
                    : 'ចូល Studio'}
                </span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* 5 Accurate Stage Metric Pills */}
          <div className="home-metrics-strip">
            <div className="home-metric-pill">
              <span className="home-metric-dot dot-cyan" />
              <span className="home-metric-label">1. Script ខ្មែរ</span>
              <span className="home-metric-val">{activeMetrics.scripted}/{totalEps}</span>
            </div>
            <div className="home-metric-pill">
              <span className="home-metric-dot dot-pink" />
              <span className="home-metric-label">2. សំឡេង AI</span>
              <span className="home-metric-val">{activeMetrics.voiced}/{totalEps}</span>
            </div>
            <div className="home-metric-pill">
              <span className="home-metric-dot dot-amber" />
              <span className="home-metric-label">3. Auto-Fit</span>
              <span className="home-metric-val">{activeMetrics.autofitted}/{totalEps}</span>
            </div>
            <div className="home-metric-pill">
              <span className="home-metric-dot dot-emerald" />
              <span className="home-metric-label">4. Clean BGM</span>
              <span className="home-metric-val">{activeMetrics.cleanBgm}/{totalEps}</span>
            </div>
            <div className="home-metric-pill">
              <span className="home-metric-dot dot-sky" />
              <span className="home-metric-label">Export MP4</span>
              <span className="home-metric-val">{activeMetrics.rendered}/{totalEps}</span>
            </div>
          </div>
        </section>

        {/* 2. Slim 4-Tile Workspace Launch Strip */}
        <section
          data-testid="home-route-directory"
          className="home-quick-routes"
          aria-label="Studio Workspaces"
        >
          {STUDIO_WORKSPACES.map((ws) => {
            const IconComp = ws.icon;
            const routeId = ws.path.replace('/', '');
            return (
              <button
                key={ws.path}
                type="button"
                data-testid={`home-route-row-${routeId}`}
                onClick={() => handleGoToRoute(ws.path)}
                className={`home-route-tile ${ws.accentClass}`}
              >
                <div className="home-route-tile-icon">
                  <IconComp size={16} />
                </div>
                <div className="home-route-tile-text">
                  <span className="home-route-tile-title">{ws.title}</span>
                  <span className="home-route-tile-sub">{ws.khmerSub}</span>
                </div>
                <ArrowRight size={14} className="home-route-tile-arrow" />
              </button>
            );
          })}
        </section>

        {/* 3. Series Folder Explorer -> Episodes Inside Folder */}
        <section data-testid="home-episodes-list" className="home-episodes-section">
          {!openedFolderSummary ? (
            <>
              {/* ROOT VIEW: Series Folders List */}
              <div className="home-episodes-toolbar">
                <div className="home-folder-header-left">
                  <Folder size={16} className="home-folder-header-icon" />
                  <span className="home-folder-header-title">បញ្ជី Folder រឿងទាំងអស់</span>
                  <span className="home-folder-count-badge">{allSeriesFolders.length} រឿង</span>
                  <span className="home-folder-hint">ចុចលើ Folder រឿង ដើម្បីបើកមើលភាគនៅខាងក្នុង</span>
                </div>

                <div className="home-toolbar-right">
                  <div className="home-search-box">
                    <Search size={13} className="home-search-icon" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ស្វែងរក Folder រឿង..."
                      className="home-search-input"
                    />
                  </div>

                  <button
                    type="button"
                    data-testid="btn-home-create-folder"
                    onClick={() => {
                      setShowNewFolderForm((prev) => !prev);
                      setCreateFolderError(null);
                    }}
                    className="home-btn-new-folder"
                  >
                    <FolderPlus size={14} />
                    <span>+ បង្កើត Folder រឿងថ្មី</span>
                  </button>
                  <button
                    type="button"
                    data-testid="btn-home-upload-folder"
                    disabled={isUploadingFolder}
                    onClick={() => {
                      setCreateFolderError(null);
                      folderUploadInputRef.current?.click();
                    }}
                    className="home-btn-upload-folder"
                    title="ជ្រើសរើស Folder ពីកុំព្យូទ័រដែលមានវីដេអូភាគស្រាប់"
                  >
                    <Upload size={14} />
                    <span>{isUploadingFolder ? 'កំពុង Upload...' : 'Upload Folder វីដេអូ'}</span>
                  </button>
                  <input
                    ref={folderUploadInputRef}
                    type="file"
                    webkitdirectory=""
                    directory=""
                    multiple
                    accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v,.ts,.flv,.wmv"
                    style={{ display: 'none' }}
                    onChange={handleUploadVideoFolder}
                  />
                </div>
              </div>

              {folderUploadProgress && (
                <div className="home-upload-folder-progress" data-testid="home-upload-folder-progress">
                  <div className="home-upload-folder-progress-top">
                    <span>
                      កំពុង Upload Folder <strong>{folderUploadProgress.folderName}</strong> ({folderUploadProgress.current}/{folderUploadProgress.total} ភាគ)
                    </span>
                    <span className="home-upload-folder-filename">{folderUploadProgress.fileName}</span>
                  </div>
                  <div className="home-upload-folder-bar">
                    <div
                      className="home-upload-folder-bar-fill"
                      style={{
                        width: `${Math.round((folderUploadProgress.current / Math.max(1, folderUploadProgress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Inline Create New Series Folder Bar */}
              {showNewFolderForm && (
                <form onSubmit={handleCreateNewFolder} className="home-new-folder-bar">
                  <FolderPlus size={15} className="home-folder-header-icon" />
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="វាយឈ្មោះ Folder រឿងថ្មី (ឧ. ss3 ឬ រឿងភាគថ្មី)..."
                    className="home-new-folder-input"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={isCreatingFolder}
                    className="home-btn-primary"
                  >
                    {isCreatingFolder ? 'កំពុងបង្កើត...' : 'បង្កើត Folder'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewFolderForm(false);
                      setCreateFolderError(null);
                    }}
                    className="home-btn-secondary"
                  >
                    <X size={13} />
                    <span>បោះបង់</span>
                  </button>
                  {createFolderError && (
                    <span className="home-new-folder-error">{createFolderError}</span>
                  )}
                </form>
              )}

              {!showNewFolderForm && createFolderError && (
                <div
                  className="home-new-folder-error"
                  style={{
                    marginBottom: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span>{createFolderError}</span>
                  <button
                    type="button"
                    onClick={() => setCreateFolderError(null)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 2 }}
                    aria-label="Close error"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Series Folders Grid */}
              {filteredFolders.length === 0 ? (
                <div className="home-episodes-empty">
                  មិនមាន Folder រឿងត្រូវនឹងការស្វែងរកទេ
                </div>
              ) : (
                <div data-testid="home-series-folders-grid" className="home-folders-grid">
                  {filteredFolders.map((folderItem) => {
                    const { id, displayTitle, isCurrentActive, metrics } = folderItem;
                    const isEditingThis = String(editingFolderId) === String(id);
                    return (
                      <div
                        key={id}
                        data-testid={`home-series-folder-${id}`}
                        onClick={() => {
                          if (!isEditingThis) handleOpenFolder(id);
                        }}
                        className={`home-folder-card ${isCurrentActive ? 'is-active-series' : ''}`}
                        title={`ចុចដើម្បីបើក Folder "${displayTitle}" និងមើលភាគទាំង ${metrics.totalEps} នៅខាងក្នុង`}
                      >
                        <div className="home-folder-card-top">
                          <div className="home-folder-title-wrap">
                            <div className={`home-folder-icon-box ${isCurrentActive ? 'is-active' : ''}`}>
                              {isCurrentActive ? <FolderOpen size={18} /> : <Folder size={18} />}
                            </div>

                            {isEditingThis ? (
                              <div
                                className="home-folder-rename-row"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={tempFolderTitle}
                                  onChange={(e) => setTempFolderTitle(e.target.value)}
                                  className="home-folder-rename-input"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveRenameFolder(e, id);
                                    if (e.key === 'Escape') setEditingFolderId(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => handleSaveRenameFolder(e, id)}
                                  className="home-folder-rename-save"
                                >
                                  រក្សាទុក
                                </button>
                              </div>
                            ) : (
                              <div className="home-folder-title-col">
                                <div className="home-folder-title-line">
                                  <span className="home-folder-name">{displayTitle}</span>
                                  {isCurrentActive && (
                                    <span className="home-folder-active-pill">កំពុងប្រើ</span>
                                  )}
                                </div>
                                <span className="home-folder-sub">
                                  {metrics.totalEps} ភាគនៅក្នុង Folder នេះ
                                </span>
                              </div>
                            )}
                          </div>

                          <div
                            className="home-folder-actions-top"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(e) => handleStartRenameFolder(e, folderItem)}
                              className="home-folder-icon-btn"
                              title="ប្តូរឈ្មោះ Folder រឿង"
                            >
                              <Edit2 size={13} />
                            </button>
                            {onDeleteSeries && (
                              <button
                                type="button"
                                data-testid={`btn-delete-folder-${id}`}
                                onClick={(e) => handleDeleteFolder(e, folderItem)}
                                className="home-folder-icon-btn btn-danger"
                                title="លុប Folder រឿងនេះ"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar inside Folder Card */}
                        <div className="home-folder-progress-wrap">
                          <div className="home-folder-progress-labels">
                            <span>វឌ្ឍនភាពផលិត (1·2·4)</span>
                            <strong className={metrics.readyPct === 100 && metrics.totalEps > 0 ? 'text-emerald' : ''}>
                              {metrics.ready124}/{metrics.totalEps} ភាគ ({metrics.readyPct}%)
                            </strong>
                          </div>
                          <div className="home-folder-progress-track">
                            <div
                              className="home-folder-progress-fill"
                              style={{ width: `${metrics.readyPct}%` }}
                            />
                          </div>
                        </div>

                        {/* 5 Stage Summary Chips inside Folder Card */}
                        <div className="home-folder-stage-chips">
                          <span className={`home-ep-chip ${metrics.scripted === metrics.totalEps && metrics.totalEps > 0 ? 'chip-script-ok' : 'chip-idle'}`}>
                            1.Script {metrics.scripted}/{metrics.totalEps}
                          </span>
                          <span className={`home-ep-chip ${metrics.voiced === metrics.totalEps && metrics.totalEps > 0 ? 'chip-voice-ok' : 'chip-idle'}`}>
                            2.Voice {metrics.voiced}/{metrics.totalEps}
                          </span>
                          <span className={`home-ep-chip ${metrics.autofitted > 0 ? 'chip-fit-ok' : 'chip-idle'}`}>
                            3.Fit {metrics.autofitted}/{metrics.totalEps}
                          </span>
                          <span className={`home-ep-chip ${metrics.cleanBgm === metrics.totalEps && metrics.totalEps > 0 ? 'chip-bgm-ok' : 'chip-idle'}`}>
                            4.BGM {metrics.cleanBgm}/{metrics.totalEps}
                          </span>
                          <span className={`home-ep-chip ${metrics.rendered > 0 ? 'chip-render-ok' : 'chip-idle'}`}>
                            MP4 {metrics.rendered}/{metrics.totalEps}
                          </span>
                        </div>

                        {/* Folder Card Footer */}
                        <div className="home-folder-card-footer">
                          <span className="home-folder-open-cta">
                            <FolderOpen size={13} />
                            <span>បើកមើលភាគក្នុង Folder ({metrics.totalEps})</span>
                            <ArrowRight size={13} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* INSIDE FOLDER VIEW: Breadcrumb + Episodes Inside This Series Folder */}
              <div className="home-episodes-toolbar">
                <div className="home-folder-breadcrumb-bar">
                  <button
                    type="button"
                    data-testid="btn-home-back-to-folders"
                    onClick={handleBackToFolders}
                    className="home-btn-back-folders"
                    title="ត្រឡប់ទៅបញ្ជី Folder រឿងទាំងអស់"
                  >
                    <ArrowLeft size={13} />
                    <span>Folder រឿងទាំងអស់</span>
                  </button>

                  <span className="home-breadcrumb-sep">/</span>

                  <div className="home-opened-folder-pill">
                    <FolderOpen size={14} className="home-folder-header-icon" />
                    <select
                      className="home-opened-folder-select"
                      value={String(openedFolderSummary.id)}
                      onChange={(e) => handleOpenFolder(e.target.value)}
                      title="ជ្រើសរើស Folder រឿងផ្សេងទៀត (Switch Folder)"
                      aria-label="Select Series Folder"
                    >
                      {allSeriesFolders.map((f) => (
                        <option key={f.id} value={String(f.id)}>
                          {f.displayTitle} ({f.metrics.totalEps} ភាគ){f.isCurrentActive ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="home-folder-count-badge">{openedMetrics.totalEps} ភាគ</span>
                  </div>

                  <div className="home-filter-tabs" role="tablist">
                    <button
                      type="button"
                      onClick={() => setFilterTab('all')}
                      className={`home-filter-tab ${filterTab === 'all' ? 'active' : ''}`}
                    >
                      ទាំងអស់ ({openedMetrics.totalEps})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterTab('incomplete')}
                      className={`home-filter-tab tab-warn ${filterTab === 'incomplete' ? 'active' : ''}`}
                    >
                      មិនទាន់ចប់ 1·2·4 ({openedMetrics.incomplete124})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterTab('autofit_todo')}
                      className={`home-filter-tab tab-amber ${filterTab === 'autofit_todo' ? 'active' : ''}`}
                    >
                      មិនទាន់ Auto-Fit ({openedMetrics.autofitTodo})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterTab('ready')}
                      className={`home-filter-tab tab-success ${filterTab === 'ready' ? 'active' : ''}`}
                    >
                      រួចរាល់ 1·2·4 ({openedMetrics.ready124})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterTab('rendered')}
                      className={`home-filter-tab ${filterTab === 'rendered' ? 'active' : ''}`}
                    >
                      Export រួច ({openedMetrics.rendered})
                    </button>
                  </div>
                </div>

                <div className="home-toolbar-right">
                  <div className="home-search-box">
                    <Search size={13} className="home-search-icon" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ស្វែងរកភាគក្នុង Folder (ឧ. 12 ឬ EP12)..."
                      className="home-search-input"
                    />
                  </div>

                  <div className="home-view-toggle" role="group" aria-label="View mode">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`home-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                      title="Compact Cards Grid"
                    >
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`home-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                      title="Table List"
                    >
                      <List size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <div className="home-episodes-empty">
                  មិនមានភាគនៅក្នុង Folder នេះទេ
                </div>
              ) : viewMode === 'grid' ? (
                <div className="home-ep-cards-grid">
                  {filteredRows.map((item) => {
                    const { ep, epNum, segCount, cleanTitle, hasScript, hasVoice, hasAutoFit, hasBgm, hasRender, isCoreReady, brokenTextCount } = item;
                    const isCurrent = String(ep.id) === String(activeEpisode?.id || episodeId);
                    return (
                      <div
                        key={ep.id || item.idx}
                        onClick={() => handleOpenEpisode(ep.id, openedFolderSummary.id)}
                        className={`home-ep-card ${isCurrent ? 'is-current' : ''} ${isCoreReady ? 'is-ready' : ''}`}
                        title="ចុចដើម្បីបើកភាគនេះក្នុង Studio"
                      >
                        <div className="home-ep-card-top">
                          <div className="home-ep-card-title-wrap">
                            <span className={`home-ep-badge ${isCurrent ? 'badge-current' : isCoreReady ? 'badge-ready' : ''}`}>
                              EP{epNum}
                            </span>
                            <span className="home-ep-card-title">{cleanTitle}</span>
                          </div>
                          <span className="home-ep-card-meta">
                            {ep.duration > 0 ? formatTimecode(ep.duration) : segCount > 0 ? `${segCount} ឃ្លា` : '—'}
                          </span>
                        </div>

                        <div className="home-ep-card-chips">
                          <span className={`home-ep-chip ${hasScript ? 'chip-script-ok' : brokenTextCount > 0 ? 'chip-warn' : 'chip-idle'}`}>
                            {hasScript ? <Check size={10} /> : brokenTextCount > 0 ? <AlertTriangle size={10} /> : <Clock size={10} />}
                            1.Script
                          </span>
                          <span className={`home-ep-chip ${hasVoice ? 'chip-voice-ok' : 'chip-idle'}`}>
                            {hasVoice ? <Check size={10} /> : <Clock size={10} />}
                            2.Voice
                          </span>
                          <span className={`home-ep-chip ${hasAutoFit ? 'chip-fit-ok' : 'chip-idle'}`}>
                            {hasAutoFit ? <Check size={10} /> : <Zap size={10} />}
                            3.Fit
                          </span>
                          <span className={`home-ep-chip ${hasBgm ? 'chip-bgm-ok' : 'chip-idle'}`}>
                            {hasBgm ? <Check size={10} /> : <Clock size={10} />}
                            4.BGM
                          </span>
                          {hasRender && (
                            <span className="home-ep-chip chip-render-ok">
                              <CheckCircle2 size={10} />
                              MP4
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="home-episodes-table-wrap">
                  <table className="home-episodes-table">
                    <thead>
                      <tr>
                        <th>ភាគ</th>
                        <th>ចំណងជើង</th>
                        <th>រយៈពេល / ឃ្លា</th>
                        <th>ដំណាក់កាលផលិត (1 · 2 · 3 · 4 · MP4)</th>
                        <th style={{ textAlign: 'right' }}>សកម្មភាព</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((item) => {
                        const { ep, epNum, segCount, cleanTitle, hasScript, hasVoice, hasAutoFit, hasBgm, hasRender } = item;
                        const isCurrent = String(ep.id) === String(activeEpisode?.id || episodeId);
                        return (
                          <tr
                            key={ep.id || item.idx}
                            onClick={() => handleOpenEpisode(ep.id, openedFolderSummary.id)}
                            className={`home-episode-row ${isCurrent ? 'is-current' : ''}`}
                          >
                            <td>
                              <span className={`home-ep-badge ${isCurrent ? 'badge-current' : ''}`}>
                                EP {String(epNum).padStart(2, '0')}
                              </span>
                            </td>
                            <td className="home-ep-title-cell">{cleanTitle}</td>
                            <td className="home-ep-seg-cell">
                              {ep.duration > 0 ? `${formatTimecode(ep.duration)} · ` : ''}
                              {segCount > 0 ? `${segCount} ឃ្លា` : 'មិនទាន់មាន'}
                            </td>
                            <td>
                              <div className="home-ep-badges-row">
                                <span className={`home-ep-chip ${hasScript ? 'chip-script-ok' : 'chip-idle'}`}>
                                  {hasScript ? <Check size={10} /> : <Clock size={10} />}
                                  1.Script
                                </span>
                                <span className={`home-ep-chip ${hasVoice ? 'chip-voice-ok' : 'chip-idle'}`}>
                                  {hasVoice ? <Check size={10} /> : <Clock size={10} />}
                                  2.Voice
                                </span>
                                <span className={`home-ep-chip ${hasAutoFit ? 'chip-fit-ok' : 'chip-idle'}`}>
                                  {hasAutoFit ? <Check size={10} /> : <Zap size={10} />}
                                  3.Auto-Fit
                                </span>
                                <span className={`home-ep-chip ${hasBgm ? 'chip-bgm-ok' : 'chip-idle'}`}>
                                  {hasBgm ? <Check size={10} /> : <Clock size={10} />}
                                  4.BGM
                                </span>
                                {hasRender && (
                                  <span className="home-ep-chip chip-render-ok">
                                    <CheckCircle2 size={10} />
                                    MP4
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEpisode(ep.id, openedFolderSummary.id);
                                }}
                                className="home-ep-open-btn"
                              >
                                កាត់ត <ArrowRight size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {/* Custom Darkroom Delete Folder Confirmation Modal */}
        {deleteTargetFolder && (
          <div
            data-testid="home-delete-folder-modal"
            className="home-delete-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeletingFolder) {
                setDeleteTargetFolder(null);
              }
            }}
          >
            <div
              className="home-delete-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-delete-modal-title"
            >
              <div className="home-delete-modal-header">
                <div className="home-delete-modal-title-row">
                  <div className="home-delete-modal-icon">
                    <Trash2 size={18} />
                  </div>
                  <div className="home-delete-modal-heading-col">
                    <h3 id="home-delete-modal-title" className="home-delete-modal-title">
                      លុប Folder រឿង (Delete Folder)
                    </h3>
                    <span className="home-delete-modal-sub">
                      សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !isDeletingFolder && setDeleteTargetFolder(null)}
                  className="home-delete-modal-close"
                  disabled={isDeletingFolder}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="home-delete-modal-target-box">
                <div className="home-delete-modal-target-left">
                  <Folder size={17} className="home-delete-target-folder-icon" />
                  <span className="home-delete-target-name">
                    {deleteTargetFolder.displayTitle}
                  </span>
                </div>
                <span className="home-delete-target-count">
                  {deleteTargetFolder.metrics?.totalEps || 0} ភាគ
                </span>
              </div>

              <p className="home-delete-modal-desc">
                តើអ្នកពិតជាចង់លុប Folder រឿង <strong>&ldquo;{deleteTargetFolder.displayTitle}&rdquo;</strong> នេះមែនទេ? ទិន្នន័យភាគទាំងអស់ និងការកាត់តក្នុង Folder នេះនឹងត្រូវលុបចេញ។
              </p>

              <div className="home-delete-modal-footer">
                <button
                  type="button"
                  data-testid="btn-cancel-delete-folder"
                  onClick={() => setDeleteTargetFolder(null)}
                  disabled={isDeletingFolder}
                  className="home-btn-secondary"
                >
                  បោះបង់ (Cancel)
                </button>
                <button
                  ref={confirmDeleteBtnRef}
                  type="button"
                  autoFocus
                  data-testid="btn-confirm-delete-folder"
                  onClick={handleConfirmDeleteFolder}
                  disabled={isDeletingFolder}
                  className="home-btn-danger-confirm"
                  title="ចុច Enter ដើម្បីលុប (Press Enter to delete)"
                >
                  <Trash2 size={14} />
                  <span>{isDeletingFolder ? 'កំពុងលុប...' : 'លុប Folder ចោល'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
