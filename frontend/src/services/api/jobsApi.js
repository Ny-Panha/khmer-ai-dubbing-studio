/**
 * Background Dubbing Jobs, Queue & Batch Render Lifecycle API
 * DragonDub AI Studio - Frontend Services
 */

import { parseResponseJson } from './client.js';

/**
 * Start Background Dubbing Pipeline Job (Async / Non-blocking)
 */
export async function startGenerationJob(params = {}) {
  const res = await fetch('/api/jobs/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return await parseResponseJson(res, 'Failed to start background dubbing job');
}

/**
 * Poll Background Dubbing Job Status
 */
export async function getJobStatus(jobId, { seriesId, episodeId, signal } = {}) {
  const query = new URLSearchParams();
  if (seriesId) query.set('seriesId', seriesId);
  if (episodeId) query.set('episodeId', episodeId);
  const qs = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`/api/jobs/${jobId}/status${qs}`, { signal });
  return await parseResponseJson(res, `Failed to poll status for job ${jobId}`);
}

/**
 * Cancel Background Dubbing Job
 */
export async function cancelJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to cancel job ${jobId}`);
}

/**
 * Kill/Cancel Translate Job(s) by jobId, episodeId, or All
 */
export async function killTranslateJobApi({ jobId, seriesId, episodeId, all = false } = {}) {
  const res = await fetch('/api/jobs/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, seriesId, episodeId, all }),
  });
  return await parseResponseJson(res, 'Failed to kill translate job');
}

/**
 * Fetch all background dubbing jobs with optional status filter (Phase 4.4 Dashboard)
 */
export async function fetchJobsListApi({ filter, signal } = {}) {
  const qs = filter && filter !== 'all' ? `?filter=${encodeURIComponent(filter)}` : '';
  const res = await fetch(`/api/jobs${qs}`, { signal });
  return await parseResponseJson(res, 'Failed to fetch jobs list');
}

/**
 * Pause a running or queued job
 */
export async function pauseJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/pause`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to pause job ${jobId}`);
}

/**
 * Resume a paused or failed job
 */
export async function resumeJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/resume`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to resume job ${jobId}`);
}

/**
 * Retry a failed or cancelled job
 */
export async function retryJobApi(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/retry`, {
    method: 'POST',
  });
  return await parseResponseJson(res, `Failed to retry job ${jobId}`);
}

/**
 * Start background Batch Export (separate files) or Full Video Merge (single concatenated MP4)
 * @param {Object} payload
 */
export async function startBatchRenderApi(payload = {}) {
  const res = await fetch('/api/render-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await parseResponseJson(res, 'Failed to start batch export job');
}

/**
 * Poll Batch Export / Merge job progress
 * @param {string} jobId
 * @param {string|null} seriesId
 */
export async function fetchBatchRenderProgressApi(jobId, seriesId = null, { signal } = {}) {
  const query = new URLSearchParams();
  if (jobId) query.set('jobId', jobId);
  if (seriesId) query.set('seriesId', seriesId);
  const res = await fetch(`/api/render-batch/progress?${query.toString()}`, { signal });
  return await parseResponseJson(res, 'Failed to fetch batch export progress');
}

/**
 * Fetch latest Batch Export / Merge job for a series
 * @param {string} seriesId
 */
export async function fetchLatestBatchRenderApi(seriesId, { signal } = {}) {
  if (!seriesId) return { success: true, job: null };
  const res = await fetch(`/api/render-batch/latest?seriesId=${encodeURIComponent(seriesId)}`, { signal });
  return await parseResponseJson(res, 'Failed to fetch latest batch export job');
}

/**
 * Cancel / Kill an active Batch Export / Merge job
 */
export async function killBatchRenderApi({ jobId = null, seriesId = null } = {}) {
  const res = await fetch('/api/render-batch/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, seriesId }),
  });
  return await parseResponseJson(res, 'Failed to stop batch export job');
}

/**
 * Enqueue ONE queued repair job per episode with broken text or missing/failed audio
 */
export async function startRepairBrokenJobApi({
  seriesId,
  episodeIds = null,
  episodeId = null,
  apiKey = null,
  modelName = null,
} = {}) {
  const res = await fetch('/api/jobs/repair-broken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seriesId,
      episodeIds,
      episodeId,
      apiKey,
      modelName,
    }),
  });
  return await parseResponseJson(res, 'Failed to enqueue repair broken job');
}

/**
 * Poll single job status (used by inline Script/Subs repair button & status checks)
 */
export async function fetchJobStatusApi(jobId, { seriesId = null, episodeId = null, signal } = {}) {
  const params = new URLSearchParams();
  if (seriesId) params.set('seriesId', seriesId);
  if (episodeId) params.set('episodeId', episodeId);
  const qs = params.toString();
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status${qs ? `?${qs}` : ''}`, { signal });
  return await parseResponseJson(res, `Failed to fetch status for job ${jobId}`);
}

