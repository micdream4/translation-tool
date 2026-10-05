import type JSZip from 'jszip';

/**
 * Text that lives inside pictures, charts and drawing shapes is not part of the text the tool
 * translates. These helpers find those objects so the user is told before exporting.
 */

export type EmbeddedVisualAreaKind = 'docx' | 'sheet' | 'page' | 'cell';

export interface EmbeddedVisualArea {
  kind: EmbeddedVisualAreaKind;
  /** docx: body | header | footer | footnotes | endnotes; sheet: sheet name; page: page number. */
  area: string;
  images: number;
  charts: number;
  /** Drawing shapes or text boxes that carry text but are not part of the translated flow. */
  shapes: number;
}

export interface EmbeddedVisualSummary {
  images: number;
  charts: number;
  shapes: number;
  areas: EmbeddedVisualArea[];
}

export const summarizeEmbeddedVisualAreas = (areas: EmbeddedVisualArea[]): EmbeddedVisualSummary => {
  const kept = areas.filter((area) => area.images + area.charts + area.shapes > 0);
  return {
    images: kept.reduce((sum, area) => sum + area.images, 0),
    charts: kept.reduce((sum, area) => sum + area.charts, 0),
    shapes: kept.reduce((sum, area) => sum + area.shapes, 0),
    areas: kept
  };
};

export const countEmbeddedVisuals = (summary?: EmbeddedVisualSummary | null) =>
  summary ? summary.images + summary.charts + summary.shapes : 0;

export const hasEmbeddedVisuals = (summary?: EmbeddedVisualSummary | null) =>
  countEmbeddedVisuals(summary) > 0;

const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;

const DOCX_AREA_PATTERNS: Array<{ area: string; pattern: RegExp }> = [
  { area: 'body', pattern: /^word\/document\.xml$/ },
  { area: 'header', pattern: /^word\/header\d*\.xml$/ },
  { area: 'footer', pattern: /^word\/footer\d*\.xml$/ },
  { area: 'footnotes', pattern: /^word\/footnotes\.xml$/ },
  { area: 'endnotes', pattern: /^word\/endnotes\.xml$/ }
];

export const scanDocxEmbeddedVisuals = async (zip: JSZip): Promise<EmbeddedVisualSummary> => {
  const byArea = new Map<string, EmbeddedVisualArea>();
  for (const path of Object.keys(zip.files)) {
    const match = DOCX_AREA_PATTERNS.find((item) => item.pattern.test(path));
    if (!match) continue;
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const entry =
      byArea.get(match.area) || { kind: 'docx' as const, area: match.area, images: 0, charts: 0, shapes: 0 };
    // A picture is an <a:blip>; older documents use <v:imagedata>.
    entry.images += countMatches(xml, /<a:blip\b/g) + countMatches(xml, /<v:imagedata\b/g);
    entry.charts += countMatches(xml, /<c:chart\b/g);
    byArea.set(match.area, entry);
  }
  return summarizeEmbeddedVisualAreas([...byArea.values()]);
};

const getXmlAttribute = (attributes: string, name: string) => {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? match[1] : '';
};

const decodeXmlText = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const resolveTarget = (baseDir: string, target: string) => {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const parts = `${baseDir}/${target}`.split('/');
  const out: string[] = [];
  parts.forEach((part) => {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  });
  return out.join('/');
};

const readRelationships = (relsXml: string) =>
  Array.from(relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)).map((match) => ({
    id: getXmlAttribute(match[1] || '', 'Id'),
    type: getXmlAttribute(match[1] || '', 'Type'),
    target: getXmlAttribute(match[1] || '', 'Target')
  }));

export const scanXlsxEmbeddedVisuals = async (zip: JSZip): Promise<EmbeddedVisualSummary> => {
  const sheetNameByPath = new Map<string, string>();
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (workbookXml && workbookRels) {
    const targets = new Map(readRelationships(workbookRels).map((rel) => [rel.id, rel.target]));
    Array.from(workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)).forEach((match) => {
      const attributes = match[1] || '';
      const target = targets.get(getXmlAttribute(attributes, 'r:id'));
      if (target) sheetNameByPath.set(resolveTarget('xl', target), decodeXmlText(getXmlAttribute(attributes, 'name')));
    });
  }

  const areas: EmbeddedVisualArea[] = [];
  let drawnImages = 0;
  const seenDrawings = new Set<string>();

  for (const [sheetPath, sheetName] of sheetNameByPath) {
    const dir = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
    const file = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
    const relsXml = await zip.file(`${dir}/_rels/${file}.rels`)?.async('string');
    if (!relsXml) continue;
    for (const rel of readRelationships(relsXml)) {
      if (!rel.type.endsWith('/drawing')) continue;
      const drawingPath = resolveTarget(dir, rel.target);
      const xml = await zip.file(drawingPath)?.async('string');
      if (!xml) continue;
      seenDrawings.add(drawingPath);
      const images = countMatches(xml, /<(?:\w+:)?pic\b/g);
      const charts = countMatches(xml, /<(?:\w+:)?chart\b/g);
      const shapes = (xml.match(/<(?:\w+:)?sp\b[\s\S]*?<\/(?:\w+:)?sp>/g) || []).filter((block) =>
        /<a:t>[^<]*\S[^<]*<\/a:t>/.test(block)
      ).length;
      drawnImages += images;
      areas.push({ kind: 'sheet', area: sheetName, images, charts, shapes });
    }
  }

  // Pictures placed inside cells are stored as media without a drawing object.
  const mediaCount = Object.keys(zip.files).filter((path) => /^xl\/media\/[^/]+$/.test(path)).length;
  if (mediaCount > drawnImages) {
    areas.push({ kind: 'cell', area: '', images: mediaCount - drawnImages, charts: 0, shapes: 0 });
  }
  return summarizeEmbeddedVisualAreas(areas);
};

export const summarizePdfVisuals = (
  pages: Array<{ pageNumber: number; imageCount: number }>
): EmbeddedVisualSummary =>
  summarizeEmbeddedVisualAreas(
    pages.map((page) => ({
      kind: 'page' as const,
      area: String(page.pageNumber),
      images: page.imageCount,
      charts: 0,
      shapes: 0
    }))
  );

/** Plain Chinese sentence for run logs, which are written in Chinese by the workflow code. */
export const describeEmbeddedVisualsForLog = (summary: EmbeddedVisualSummary) => {
  const parts = [
    summary.images ? `${summary.images} 张图片` : '',
    summary.charts ? `${summary.charts} 个图表` : '',
    summary.shapes ? `${summary.shapes} 个绘图形状里的文字` : ''
  ].filter(Boolean);
  return `图片提示: 检测到 ${parts.join('、')}，其中的文字不会被翻译，导出后保持原文，请人工处理。`;
};

/** English line for the exported quality report, which is written in English. */
export const describeEmbeddedVisualsForReport = (summary?: EmbeddedVisualSummary | null) => {
  if (!summary || !hasEmbeddedVisuals(summary)) return '';
  const parts = [
    summary.images ? `${summary.images} images` : '',
    summary.charts ? `${summary.charts} charts` : '',
    summary.shapes ? `${summary.shapes} drawing shapes with text` : ''
  ].filter(Boolean);
  return `Untranslated embedded content: ${parts.join(', ')}. Text inside them is not translated and needs manual work.`;
};
