const { runDubbingPipeline, CASCADE_MODELS } = require('./dubbingPipeline');
const { runEpisodePipeline } = require('./episodePipelineOrchestrator');
const { PIPELINE_STAGES, PIPELINE_STATUS, GENERATION_MODES, createCanonicalSegment } = require('./pipelineTypes');
const { ingestEpisode } = require('./stages/stage1_ingestEpisode');
const { analyzeSourceMedia } = require('./stages/stage2_analyzeSourceMedia');
const { extractChineseSubtitles } = require('./stages/stage3_extractChineseSubtitles');
const { analyzeDialogueAudio } = require('./stages/stage4_analyzeDialogueAudio');
const { reconcileTimelineEvidence } = require('./stages/stage5_reconcileTimelineEvidence');
const { generateModeSpecificScript } = require('./stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('./stages/stage7_translateAndValidateKhmer');
const { validateSubtitleTiming } = require('./stages/stage8_validateSubtitleTiming');
const { generateSegmentTTS } = require('./stages/stage9_generateSegmentTTS');
const { previewAndExport } = require('./stages/stage10_previewAndExport');

const { runChunkedDubbingPipeline, generateChunkPlan, stitchAndDeduplicateSegments } = require('./chunkOrchestrator');
const {
  createJob,
  getJob,
  getAllJobs,
  updateJob,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
  getJobSignal,
  saveCheckpoint,
  getLatestValidCheckpoint,
  recordSegmentCompletion,
  loadSegmentLedger,
  verifySegmentAudioIntegrity,
  recoverDanglingJobs,
} = require('./jobManager');

module.exports = {
  runDubbingPipeline,
  runEpisodePipeline,
  runChunkedDubbingPipeline,
  generateChunkPlan,
  stitchAndDeduplicateSegments,
  createJob,
  getJob,
  getAllJobs,
  updateJob,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
  getJobSignal,
  saveCheckpoint,
  getLatestValidCheckpoint,
  recordSegmentCompletion,
  loadSegmentLedger,
  verifySegmentAudioIntegrity,
  recoverDanglingJobs,
  CASCADE_MODELS,
  PIPELINE_STAGES,
  PIPELINE_STATUS,
  GENERATION_MODES,
  createCanonicalSegment,
  ingestEpisode,
  analyzeSourceMedia,
  extractChineseSubtitles,
  analyzeDialogueAudio,
  reconcileTimelineEvidence,
  generateModeSpecificScript,
  translateAndValidateKhmer,
  validateSubtitleTiming,
  generateSegmentTTS,
  previewAndExport,
};
