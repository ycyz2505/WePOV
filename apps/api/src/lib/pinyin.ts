/**
 * Pinyin initials for member search (§5.1).
 *
 * `class_members.real_name_pinyin` and `profiles.nickname_pinyin` store
 * space-separated pinyin (e.g. "zong guan li yuan"). The login page filters
 * members by the first letter of each syllable, so we split on whitespace or
 * hyphens, take each part's first character, lowercase, and concatenate.
 */
export function pinyinInitials(realNamePinyin: string, nicknamePinyin: string): string {
  const source = realNamePinyin.trim().length > 0 ? realNamePinyin.trim() : nicknamePinyin.trim()
  if (source.length === 0) return ''
  return source
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toLowerCase())
    .join('')
}
