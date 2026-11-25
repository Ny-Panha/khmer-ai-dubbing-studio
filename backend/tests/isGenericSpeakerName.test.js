/**
 * Unit tests for isGenericSpeakerName helper function
 * Task 3.1: Generic Identity Detection for Bug Condition 1
 * 
 * Requirements:
 * - Detect generic/broadcast identities: ប្រព័ន្ធ, system keywords (系统, 恭喜玩家, 规则警告), narrator patterns
 * - Return true for transient broadcast identities
 * - Return false for recurring character names
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isGenericSpeakerName } = require('../models/speakerRegistry');

test('isGenericSpeakerName: Khmer generic/broadcast identities', () => {
  // Primary system identity
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធ'), true, 'Should detect "ប្រព័ន្ធ" (system)');
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធ AI'), true, 'Should detect "ប្រព័ន្ធ AI"');
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធជំនួយ'), true, 'Should detect "ប្រព័ន្ធជំនួយ" (help system)');
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធណែនាំ'), true, 'Should detect "ប្រព័ន្ធណែនាំ" (guide system)');
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធសំឡេង'), true, 'Should detect "ប្រព័ន្ធសំឡេង" (voice system)');
  
  // Narrator/announcer identities
  assert.equal(isGenericSpeakerName('ឧទ្ទេសក'), true, 'Should detect "ឧទ្ទេសក" (announcer)');
  assert.equal(isGenericSpeakerName('អ្នកសម្រាយរឿង'), true, 'Should detect "អ្នកសម្រាយរឿង" (narrator)');
  assert.equal(isGenericSpeakerName('អ្នកនិទាន'), true, 'Should detect "អ្នកនិទាន" (storyteller)');
  assert.equal(isGenericSpeakerName('ពិធីករ'), true, 'Should detect "ពិធីករ" (host/MC)');
});

test('isGenericSpeakerName: Chinese generic/broadcast identities', () => {
  // System keywords
  assert.equal(isGenericSpeakerName('system'), true, 'Should detect "system"');
  assert.equal(isGenericSpeakerName('AI System'), true, 'Should detect "AI System"');
  assert.equal(isGenericSpeakerName('系统'), true, 'Should detect "系统" (system)');
  assert.equal(isGenericSpeakerName('系统提示'), true, 'Should detect "系统提示" (system prompt)');
  
  // Game/world broadcast keywords from Bug Condition 1 examples
  assert.equal(isGenericSpeakerName('恭喜玩家'), true, 'Should detect "恭喜玩家" (congratulations player)');
  assert.equal(isGenericSpeakerName('规则'), true, 'Should detect "规则" (rules)');
  assert.equal(isGenericSpeakerName('规则警告'), true, 'Should detect "规则警告" (rule warning)');
  assert.equal(isGenericSpeakerName('世界公告'), true, 'Should detect "世界公告" (world announcement)');
  assert.equal(isGenericSpeakerName('公告'), true, 'Should detect "公告" (announcement)');
  assert.equal(isGenericSpeakerName('提示'), true, 'Should detect "提示" (hint/prompt)');
  
  // Narrator/announcer identities
  assert.equal(isGenericSpeakerName('旁白'), true, 'Should detect "旁白" (narrator)');
  assert.equal(isGenericSpeakerName('解说'), true, 'Should detect "解说" (commentator)');
  assert.equal(isGenericSpeakerName('播音'), true, 'Should detect "播音" (broadcaster)');
  assert.equal(isGenericSpeakerName('主持人'), true, 'Should detect "主持人" (host)');
});

test('isGenericSpeakerName: English narrator patterns', () => {
  // Narrator patterns from requirements
  assert.equal(isGenericSpeakerName('Narrator'), true, 'Should detect "Narrator"');
  assert.equal(isGenericSpeakerName('NARRATOR'), true, 'Should detect "NARRATOR" (case insensitive)');
  assert.equal(isGenericSpeakerName('narrator'), true, 'Should detect "narrator" (lowercase)');
  
  assert.equal(isGenericSpeakerName('System'), true, 'Should detect "System"');
  assert.equal(isGenericSpeakerName('SYSTEM'), true, 'Should detect "SYSTEM"');
  
  assert.equal(isGenericSpeakerName('Announcer'), true, 'Should detect "Announcer"');
  assert.equal(isGenericSpeakerName('ANNOUNCER'), true, 'Should detect "ANNOUNCER"');
  
  assert.equal(isGenericSpeakerName('Voice Over'), true, 'Should detect "Voice Over"');
  assert.equal(isGenericSpeakerName('VoiceOver'), true, 'Should detect "VoiceOver"');
  assert.equal(isGenericSpeakerName('V.O.'), true, 'Should detect "V.O."');
  assert.equal(isGenericSpeakerName('v.o.'), true, 'Should detect "v.o."');
});

test('isGenericSpeakerName: Case insensitivity and whitespace handling', () => {
  // Case variations
  assert.equal(isGenericSpeakerName('SYSTEM'), true, 'Should handle uppercase');
  assert.equal(isGenericSpeakerName('System'), true, 'Should handle mixed case');
  assert.equal(isGenericSpeakerName('system'), true, 'Should handle lowercase');
  
  // Whitespace variations
  assert.equal(isGenericSpeakerName('  系统  '), true, 'Should trim whitespace');
  assert.equal(isGenericSpeakerName('\t恭喜玩家\n'), true, 'Should handle tabs and newlines');
  assert.equal(isGenericSpeakerName('  ប្រព័ន្ធ  '), true, 'Should trim Khmer text');
});

test('isGenericSpeakerName: Recurring character names (should return FALSE)', () => {
  // Named characters - should NOT be detected as generic
  assert.equal(isGenericSpeakerName('ស៊ូ មីង'), false, 'Should NOT detect recurring character "ស៊ូ មីង"');
  assert.equal(isGenericSpeakerName('នាង ស៊ូ'), false, 'Should NOT detect recurring character "នាង ស៊ូ"');
  assert.equal(isGenericSpeakerName('លោកប្រធាន'), false, 'Should NOT detect character title "លោកប្រធាន"');
  assert.equal(isGenericSpeakerName('អ្នកនាងលី'), false, 'Should NOT detect named character "អ្នកនាងលី"');
  
  // Chinese character names
  assert.equal(isGenericSpeakerName('小明'), false, 'Should NOT detect character name "小明"');
  assert.equal(isGenericSpeakerName('张三'), false, 'Should NOT detect character name "张三"');
  assert.equal(isGenericSpeakerName('李四'), false, 'Should NOT detect character name "李四"');
  assert.equal(isGenericSpeakerName('王医生'), false, 'Should NOT detect character "王医生" (Dr. Wang)');
  
  // Role-based character names (not generic broadcast)
  assert.equal(isGenericSpeakerName('តួឯកប្រុស'), false, 'Should NOT detect "តួឯកប្រុស" (male lead)');
  assert.equal(isGenericSpeakerName('តួឯកស្រី'), false, 'Should NOT detect "តួឯកស្រី" (female lead)');
  assert.equal(isGenericSpeakerName('男主'), false, 'Should NOT detect "男主" (male lead)');
  assert.equal(isGenericSpeakerName('女主'), false, 'Should NOT detect "女主" (female lead)');
  
  // English character names
  assert.equal(isGenericSpeakerName('John'), false, 'Should NOT detect name "John"');
  assert.equal(isGenericSpeakerName('Mary Smith'), false, 'Should NOT detect name "Mary Smith"');
  assert.equal(isGenericSpeakerName('Dr. Johnson'), false, 'Should NOT detect "Dr. Johnson"');
  assert.equal(isGenericSpeakerName('Captain Lee'), false, 'Should NOT detect "Captain Lee"');
});

test('isGenericSpeakerName: Substring matching within character names', () => {
  // Names that CONTAIN generic keywords but are actually character names
  // These should return TRUE because they contain the generic keyword
  assert.equal(isGenericSpeakerName('系统管理员'), true, 'Should detect "系统管理员" (contains "系统")');
  assert.equal(isGenericSpeakerName('小系统'), true, 'Should detect "小系统" (contains "系统")');
  
  // But specific character names without generic keywords should be false
  assert.equal(isGenericSpeakerName('管理员'), false, 'Should NOT detect "管理员" (admin, no generic keyword)');
  assert.equal(isGenericSpeakerName('小明'), false, 'Should NOT detect "小明" (name without generic keyword)');
});

test('isGenericSpeakerName: Edge cases and invalid inputs', () => {
  // Empty/null/undefined inputs
  assert.equal(isGenericSpeakerName(''), false, 'Should return false for empty string');
  assert.equal(isGenericSpeakerName(null), false, 'Should return false for null');
  assert.equal(isGenericSpeakerName(undefined), false, 'Should return false for undefined');
  
  // Non-string inputs (defensive programming)
  assert.equal(isGenericSpeakerName(123), false, 'Should return false for number');
  assert.equal(isGenericSpeakerName({}), false, 'Should return false for object');
  assert.equal(isGenericSpeakerName([]), false, 'Should return false for array');
  
  // Single characters or very short strings
  assert.equal(isGenericSpeakerName('S'), false, 'Should return false for single character');
  assert.equal(isGenericSpeakerName('A'), false, 'Should return false for single letter');
  assert.equal(isGenericSpeakerName('系'), false, 'Should return false for partial Chinese character');
});

test('isGenericSpeakerName: Real-world Bug Condition 1 examples from benchmark', () => {
  // Examples from design.md Bug Condition 1
  // Episode 5, Cue #42: ប្រព័ន្ធ assigned wrong gender from series map
  assert.equal(isGenericSpeakerName('ប្រព័ន្ធ'), true, 'Episode 5 Cue #42: "ប្រព័ន្ធ" should be generic');
  
  // Episode 20, Cue #15: System broadcast "恭喜玩家通关"
  assert.equal(isGenericSpeakerName('恭喜玩家'), true, 'Episode 20 Cue #15: "恭喜玩家" should be generic');
  
  // Episode 4, Cue #58: World announcement "规则警告"
  assert.equal(isGenericSpeakerName('规则警告'), true, 'Episode 4 Cue #58: "规则警告" should be generic');
  
  // Contrast: Recurring character from benchmarks should NOT be generic
  assert.equal(isGenericSpeakerName('ស៊ូ មីង'), false, 'Recurring character "ស៊ូ មីង" should NOT be generic');
});

test('isGenericSpeakerName: Distinction from placeholder names', () => {
  // These are placeholder names (detected by old isGenericSpeakerName)
  // but NOT broadcast identities (new isGenericSpeakerName)
  // The new function should NOT detect these - they're handled separately by isPlaceholderSpeakerName
  
  assert.equal(isGenericSpeakerName('Speaker 1'), false, 'Placeholder "Speaker 1" is NOT a broadcast identity');
  assert.equal(isGenericSpeakerName('Speaker 2'), false, 'Placeholder "Speaker 2" is NOT a broadcast identity');
  assert.equal(isGenericSpeakerName('Unknown'), false, 'Placeholder "Unknown" is NOT a broadcast identity');
  assert.equal(isGenericSpeakerName('spk_1'), false, 'Placeholder "spk_1" is NOT a broadcast identity');
  assert.equal(isGenericSpeakerName('Default Speaker'), false, 'Placeholder "Default Speaker" is NOT a broadcast identity');
  assert.equal(isGenericSpeakerName('តួអង្គ'), false, 'Placeholder "តួអង្គ" (character) is NOT a broadcast identity');
  
  // But actual broadcast/system names should be detected
  assert.equal(isGenericSpeakerName('System'), true, 'Broadcast "System" IS a broadcast identity');
  assert.equal(isGenericSpeakerName('Narrator'), true, 'Broadcast "Narrator" IS a broadcast identity');
});
