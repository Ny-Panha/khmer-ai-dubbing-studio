/**
 * Sanitize and enforce clean Khmer script.
 * Removes stray Thai Unicode characters or common Thai loanwords.
 */
export function cleanKhmerText(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/ไอ้/g, 'អា');
  s = s.replace(/ออกมานี่/g, 'ចេញមកនេះ');
  s = s.replace(/ออกมา/g, 'ចេញមក');
  s = s.replace(/អ្នក?ผู้?บรรยาย/g, 'អ្នករៀបរាប់');
  s = s.replace(/บรรยาย/g, 'រៀបរាប់');
  s = s.replace(/ยาก/g, 'ពិបាក');
  s = s.replace(/มั่ง/g, 'ខ្លះ');
  s = s.replace(/มึง/g, 'ឯង');
  s = s.replace(/กู/g, 'អញ');
  s = s.replace(/[\u0E00-\u0E7F]+/g, '');
  s = s.replace(/[\u0E80-\u0EFF]+/g, '');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}
