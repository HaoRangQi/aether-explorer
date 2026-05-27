import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

const files = {
  zh: resolve(root, 'README.md'),
  en: resolve(root, 'README_EN.md'),
};

const headingKeys = new Map([
  ['团队', 'team'],
  ['Team', 'team'],
  ['截图', 'screenshots'],
  ['Screenshots', 'screenshots'],
  ['浅色模式', 'light-mode'],
  ['Light Mode', 'light-mode'],
  ['深色模式', 'dark-mode'],
  ['Dark Mode', 'dark-mode'],
  ['设置页面', 'settings-screenshot'],
  ['Settings', 'settings-screenshot'],
  ['特性', 'features'],
  ['Features', 'features'],
  ['文件浏览', 'file-browsing'],
  ['File Browsing', 'file-browsing'],
  ['macOS 深度集成', 'macos-deep-integration'],
  ['macOS Deep Integration', 'macos-deep-integration'],
  ['窗口与标签页', 'windows-tabs'],
  ['Windows & Tabs', 'windows-tabs'],
  ['设置与个性化', 'settings-customization'],
  ['Settings & Customization', 'settings-customization'],
  ['已知不足', 'known-limitations'],
  ['Known Limitations', 'known-limitations'],
  ['技术栈', 'tech-stack'],
  ['Tech Stack', 'tech-stack'],
  ['快速开始', 'quick-start'],
  ['Quick Start', 'quick-start'],
  ['环境要求', 'prerequisites'],
  ['Prerequisites', 'prerequisites'],
  ['开发', 'development'],
  ['Development', 'development'],
  ['构建', 'build'],
  ['Build', 'build'],
  ['项目结构', 'project-structure'],
  ['Project Structure', 'project-structure'],
  ['功能清单', 'feature-list'],
  ['Feature List', 'feature-list'],
  ['文档治理', 'documentation-governance'],
  ['Documentation Governance', 'documentation-governance'],
  ['注意事项', 'notes'],
  ['Notes', 'notes'],
  ['常见问题', 'troubleshooting'],
  ['Troubleshooting', 'troubleshooting'],
  ['未签名构建如何打开', 'opening-unsigned-builds'],
  ['Opening unsigned builds', 'opening-unsigned-builds'],
  ['License', 'license'],
]);

const requiredKeys = [
  'team',
  'screenshots',
  'features',
  'known-limitations',
  'tech-stack',
  'quick-start',
  'project-structure',
  'feature-list',
  'notes',
  'troubleshooting',
  'license',
];

function extractHeadingStructure(filePath) {
  const markdown = readFileSync(filePath, 'utf8');
  const headings = [];
  const unknownHeadings = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const level = match[1].length;
    const title = match[2].replace(/\s+#+$/, '').trim();
    const key = headingKeys.get(title);

    if (!key) {
      unknownHeadings.push(`${'#'.repeat(level)} ${title}`);
      continue;
    }

    headings.push({ level, key, title });
  }

  return { headings, unknownHeadings };
}

function formatHeading({ level, key, title }) {
  return `${'#'.repeat(level)} ${title} (${key})`;
}

function fail(message, details = []) {
  console.error(`README sync check failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const zh = extractHeadingStructure(files.zh);
const en = extractHeadingStructure(files.en);

if (zh.unknownHeadings.length > 0 || en.unknownHeadings.length > 0) {
  fail('found headings without a sync key', [
    ...zh.unknownHeadings.map((heading) => `README.md: ${heading}`),
    ...en.unknownHeadings.map((heading) => `README_EN.md: ${heading}`),
  ]);
}

const missingRequired = requiredKeys.flatMap((key) => {
  const missing = [];
  if (!zh.headings.some((heading) => heading.key === key)) {
    missing.push(`README.md missing required section: ${key}`);
  }
  if (!en.headings.some((heading) => heading.key === key)) {
    missing.push(`README_EN.md missing required section: ${key}`);
  }
  return missing;
});

if (missingRequired.length > 0) {
  fail('required sections are missing', missingRequired);
}

const zhStructure = zh.headings.map(({ level, key }) => `${level}:${key}`);
const enStructure = en.headings.map(({ level, key }) => `${level}:${key}`);

if (zhStructure.length !== enStructure.length) {
  fail('heading counts differ', [
    `README.md has ${zhStructure.length} tracked headings`,
    `README_EN.md has ${enStructure.length} tracked headings`,
  ]);
}

const mismatches = [];
for (let index = 0; index < zhStructure.length; index += 1) {
  if (zhStructure[index] !== enStructure[index]) {
    mismatches.push(
      `position ${index + 1}: README.md ${formatHeading(zh.headings[index])} != README_EN.md ${formatHeading(en.headings[index])}`,
    );
  }
}

if (mismatches.length > 0) {
  fail('heading structures differ', mismatches);
}

console.log(`README sync check passed: ${zhStructure.length} tracked headings match.`);
