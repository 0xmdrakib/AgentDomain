export interface CompactQuantity {
  value: number;
  suffix: 'k' | 'm';
}

interface LabelMatch {
  labelStart: number;
  valueStart: number;
}

function isAsciiWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isAsciiLetter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z'))
  );
}

function isAsciiAlphanumeric(character: string | undefined): boolean {
  return isAsciiDigit(character) || isAsciiLetter(character);
}

function isWordCharacter(character: string | undefined): boolean {
  return isAsciiAlphanumeric(character) || character === '_';
}

function isEmailLocalCharacter(character: string | undefined): boolean {
  return (
    isAsciiAlphanumeric(character) ||
    character === '.' ||
    character === '_' ||
    character === '%' ||
    character === '+' ||
    character === '-'
  );
}

function isEmailDomainCharacter(character: string | undefined): boolean {
  return isAsciiAlphanumeric(character) || character === '.' || character === '-';
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length && isAsciiWhitespace(text[cursor])) cursor += 1;
  return cursor;
}

function asciiCharactersEqual(left: string | undefined, right: string): boolean {
  if (left === right) return true;
  if (left === undefined || !isAsciiLetter(left) || !isAsciiLetter(right)) return false;
  return (left.charCodeAt(0) | 32) === (right.charCodeAt(0) | 32);
}

function matchesAsciiCaseInsensitive(text: string, pattern: string, start: number): boolean {
  if (start + pattern.length > text.length) return false;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (!asciiCharactersEqual(text[start + offset], pattern[offset]!)) return false;
  }
  return true;
}

function findLabeledValue(
  text: string,
  labels: readonly string[],
  requireSeparator: boolean,
  fromIndex = 0,
  requireWhitespaceBefore = false,
): LabelMatch | null {
  let best: LabelMatch | null = null;

  for (const label of labels) {
    let searchFrom = fromIndex;
    while (searchFrom + label.length <= text.length) {
      if (!matchesAsciiCaseInsensitive(text, label, searchFrom)) {
        searchFrom += 1;
        continue;
      }

      const labelStart = searchFrom;
      const labelEnd = labelStart + label.length;
      const hasStartBoundary = labelStart === 0 || !isWordCharacter(text[labelStart - 1]);
      const hasEndBoundary = labelEnd === text.length || !isWordCharacter(text[labelEnd]);
      const hasRequiredWhitespace =
        !requireWhitespaceBefore ||
        labelStart === fromIndex ||
        isAsciiWhitespace(text[labelStart - 1]);
      if (hasStartBoundary && hasEndBoundary && hasRequiredWhitespace) {
        let valueStart = skipWhitespace(text, labelEnd);
        const hasSeparator = text[valueStart] === ':' || text[valueStart] === '=';
        if (hasSeparator) valueStart = skipWhitespace(text, valueStart + 1);

        if (!requireSeparator || hasSeparator) {
          if (best === null || labelStart < best.labelStart) best = { labelStart, valueStart };
          break;
        }
      }

      searchFrom += 1;
    }
  }

  return best;
}

export function readLabeledRemainder(
  text: string,
  labels: readonly string[],
  options: {
    requireSeparator?: boolean;
    stopCharacter?: string;
    stopLabels?: readonly string[];
  } = {},
): string | undefined {
  const match = findLabeledValue(text, labels, options.requireSeparator ?? true);
  if (match === null) return undefined;

  let valueEnd = text.length;
  if (options.stopCharacter) {
    const stop = text.indexOf(options.stopCharacter, match.valueStart);
    if (stop >= 0) valueEnd = stop;
  }
  if (options.stopLabels?.length) {
    const stop = findLabeledValue(text, options.stopLabels, true, match.valueStart, true);
    if (stop !== null && stop.labelStart < valueEnd) valueEnd = stop.labelStart;
  }

  const value = text.slice(match.valueStart, valueEnd).trim();
  return value || undefined;
}

export function readLabeledEmailUsername(
  text: string,
  labels: readonly string[],
): string | undefined {
  const match = findLabeledValue(text, labels, false);
  if (match === null || !isEmailLocalCharacter(text[match.valueStart])) return undefined;

  let end = match.valueStart;
  while (end < text.length && isEmailLocalCharacter(text[end])) end += 1;
  return text.slice(match.valueStart, end);
}

function isValidDomain(domain: string): boolean {
  let labelStart = 0;
  let dotCount = 0;
  for (let index = 0; index <= domain.length; index += 1) {
    if (index < domain.length && domain[index] !== '.') {
      if (!isAsciiAlphanumeric(domain[index]) && domain[index] !== '-') return false;
      continue;
    }

    if (
      index === labelStart ||
      !isAsciiAlphanumeric(domain[labelStart]) ||
      !isAsciiAlphanumeric(domain[index - 1])
    ) {
      return false;
    }
    if (index < domain.length) {
      dotCount += 1;
      labelStart = index + 1;
    }
  }

  if (dotCount < 1 || domain.length - labelStart < 2) return false;
  for (let index = labelStart; index < domain.length; index += 1) {
    if (!isAsciiLetter(domain[index])) return false;
  }
  return true;
}

function isValidEmailParts(local: string, domain: string): boolean {
  if (!local || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain) {
    return false;
  }
  return isValidDomain(domain);
}

function readEmailAt(text: string, start: number): { email?: string; nextIndex: number } {
  if (!isEmailLocalCharacter(text[start])) return { nextIndex: start + 1 };

  let cursor = start;
  while (cursor < text.length && isEmailLocalCharacter(text[cursor])) cursor += 1;
  const localEnd = cursor;
  if (text[cursor] !== '@') return { nextIndex: cursor };

  cursor += 1;
  const domainStart = cursor;
  while (cursor < text.length && isEmailDomainCharacter(text[cursor])) cursor += 1;

  let addressEnd = cursor;
  while (addressEnd > domainStart && text[addressEnd - 1] === '.') addressEnd -= 1;
  const local = text.slice(start, localEnd);
  const domain = text.slice(domainStart, addressEnd);
  return {
    email: isValidEmailParts(local, domain) ? text.slice(start, addressEnd) : undefined,
    nextIndex: Math.max(cursor, start + 1),
  };
}

export function extractEmailAddresses(text: string): string[] {
  const emails: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (!isEmailLocalCharacter(text[cursor])) {
      cursor += 1;
      continue;
    }
    const result = readEmailAt(text, cursor);
    if (result.email) emails.push(result.email);
    cursor = result.nextIndex;
  }
  return emails;
}

export function readLabeledEmail(text: string, labels: readonly string[]): string | undefined {
  const match = findLabeledValue(text, labels, true);
  if (match === null) return undefined;
  return readEmailAt(text, match.valueStart).email;
}

export function extractFencedBlock(
  text: string,
  optionalLanguages: readonly string[],
): string | undefined {
  const openingFence = text.indexOf('```');
  if (openingFence < 0) return undefined;

  let contentStart = openingFence + 3;
  for (const language of optionalLanguages) {
    if (matchesAsciiCaseInsensitive(text, language, contentStart)) {
      contentStart += language.length;
      break;
    }
  }
  contentStart = skipWhitespace(text, contentStart);

  const closingFence = text.indexOf('```', contentStart);
  return closingFence < 0 ? undefined : text.slice(contentStart, closingFence);
}

export function parseCompactQuantity(text: string): CompactQuantity | undefined {
  let cursor = 0;
  while (cursor < text.length) {
    if (!isAsciiDigit(text[cursor])) {
      cursor += 1;
      continue;
    }

    const numberStart = cursor;
    while (cursor < text.length && isAsciiDigit(text[cursor])) cursor += 1;
    if (text[cursor] === '.' && isAsciiDigit(text[cursor + 1])) {
      cursor += 1;
      while (cursor < text.length && isAsciiDigit(text[cursor])) cursor += 1;
    }
    const numberEnd = cursor;
    const suffixIndex = skipWhitespace(text, cursor);
    const suffix = text[suffixIndex]?.toLowerCase();
    if (suffix === 'k' || suffix === 'm') {
      const value = Number(text.slice(numberStart, numberEnd));
      if (Number.isFinite(value)) return { value, suffix };
    }
  }
  return undefined;
}
