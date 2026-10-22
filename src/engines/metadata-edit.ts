// Edit metadata: set or clear the document's title, author and other details.
// Kept in its own file (next to readMetadata/stripMetadata in pdflib-ops) and
// run in the pdf-lib worker like every other edit.
import { PDFName, type PDFDict } from 'pdf-lib';
import { load, removeXmp, UserFacingError } from './pdflib-ops';

/** The details a user can edit. These names are the keys of the PDF's /Info dictionary. */
export const EDITABLE_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];
export type MetadataEdit = { values: Partial<Record<EditableKey, string>>; touchModified: boolean };

export const MAX_FIELD_LENGTH = 1000;

/**
 * Tidies one value: control characters (line breaks, tabs, NUL...) become
 * spaces, runs of spaces collapse and the ends are trimmed. An empty result
 * means "remove this field".
 */
export function cleanValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Writes the given values into the document's /Info dictionary. Fields not in
 * `values` are left as they are; an empty value removes the field. The XMP
 * metadata stream (a second, XML copy of the same details that Preview and
 * Acrobat often show instead) is removed, so old values cannot linger there.
 */
export async function editMetadata(bytes: Uint8Array, edit: MetadataEdit): Promise<Uint8Array> {
  const doc = await load(bytes);
  const cleaned: [EditableKey, string][] = [];
  for (const key of EDITABLE_KEYS) {
    if (!(key in edit.values)) continue;
    const value = cleanValue(edit.values[key]);
    if (value.length > MAX_FIELD_LENGTH) throw new UserFacingError(`${key} is too long (at most ${MAX_FIELD_LENGTH} characters).`);
    cleaned.push([key, value]);
  }

  // The setters create the /Info dictionary when the file has none. They store
  // text as UTF-16, so accents and non-Latin scripts survive.
  for (const [key, value] of cleaned) {
    if (!value) continue;
    if (key === 'Title') doc.setTitle(value);
    else if (key === 'Author') doc.setAuthor(value);
    else if (key === 'Subject') doc.setSubject(value);
    else if (key === 'Keywords') doc.setKeywords([value]);
    else if (key === 'Creator') doc.setCreator(value);
    else doc.setProducer(value);
  }
  if (edit.touchModified) doc.setModificationDate(new Date());

  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : undefined;
  if (info && 'delete' in info) {
    for (const [key, value] of cleaned) if (!value) (info as PDFDict).delete(PDFName.of(key));
  }

  removeXmp(doc);
  return doc.save({ useObjectStreams: true });
}
