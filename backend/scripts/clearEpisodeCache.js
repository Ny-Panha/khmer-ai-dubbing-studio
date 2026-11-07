/**
 * clearEpisodeCache.js
 * ឧបករណ៍សម្អាត Cache ចាស់ៗ (ASR Cache & Chunk Cache) ដើម្បីឱ្យការ Generate Dialogue ថ្មី
 * ដំណើរការកូដស្រង់សំឡេង និងបំបែក Gender/SpeakerId ដោយផ្ទាល់ 100% ដោយមិនជាប់ទិន្នន័យចាស់!
 *
 * របៀបរត់៖
 * 1. សម្អាត ASR Cache ទាំងអស់៖ node backend/scripts/clearEpisodeCache.js --all
 * 2. សម្អាត Cache ជាក់លាក់នៃ Series/Episode: node backend/scripts/clearEpisodeCache.js --series <seriesId> --episode <episodeId>
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'uploads', 'cache');
const CHUNKS_CACHE_DIR = path.join(CACHE_DIR, 'chunks');
const ROOT_CHUNKS_CACHE_DIR = path.join(__dirname, '..', '..', 'uploads', 'cache', 'chunks');

function clearCache(options = {}) {
  const { all = false, seriesId = null, episodeId = null } = options;
  console.log(`\n🧹 [Clear Cache] ចាប់ផ្តើមសម្អាត Cache (uploads/cache)...`);

  let removedCount = 0;

  // 1. Clear ASR JSON cache
  if (fs.existsSync(CACHE_DIR)) {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      const fullPath = path.join(CACHE_DIR, file);
      if (fs.statSync(fullPath).isFile() && (file.startsWith('asr_') || file.endsWith('.json'))) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`   🗑️ បានលុប ASR Cache: ${file}`);
          removedCount++;
        } catch (err) {
          console.warn(`   ⚠️ មិនអាចលុប ${file}:`, err.message);
        }
      }
    }
  }

  // 2. Clear Chunks Cache
  for (const cDir of [CHUNKS_CACHE_DIR, ROOT_CHUNKS_CACHE_DIR]) {
    if (fs.existsSync(cDir)) {
      const chunkFiles = fs.readdirSync(cDir);
      for (const file of chunkFiles) {
        const fullPath = path.join(cDir, file);
        try {
          fs.unlinkSync(fullPath);
          console.log(`   🗑️ បានលុប Chunk Cache: ${file}`);
          removedCount++;
        } catch (err) {
          console.warn(`   ⚠️ មិនអាចលុប ${file}:`, err.message);
        }
      }
    }
  }

  // 3. Clear Episode Job Checkpoints if specified
  if (seriesId && episodeId) {
    const epJobDir = path.join(__dirname, '..', 'uploads', 'projects', seriesId, 'episodes', episodeId, 'jobs');
    if (fs.existsSync(epJobDir)) {
      const jobFiles = fs.readdirSync(epJobDir);
      for (const jf of jobFiles) {
        try {
          fs.unlinkSync(path.join(epJobDir, jf));
          console.log(`   🗑️ បានលុប Episode Job Checkpoint: ${jf}`);
          removedCount++;
        } catch (err) {
          console.warn(`   ⚠️ មិនអាចលុប ${jf}:`, err.message);
        }
      }
    }
  }

  console.log(`\n✅ បានសម្អាតសរុប ${removedCount} ឯកសារ Cache រួចរាល់!\n`);
  return removedCount;
}

if (require.main === module) {
  const isAll = process.argv.includes('--all');
  const seriesIdx = process.argv.indexOf('--series');
  const epIdx = process.argv.indexOf('--episode');
  const seriesId = seriesIdx !== -1 ? process.argv[seriesIdx + 1] : null;
  const episodeId = epIdx !== -1 ? process.argv[epIdx + 1] : null;

  clearCache({ all: isAll || (!seriesId && !episodeId), seriesId, episodeId });
}

module.exports = { clearCache };

