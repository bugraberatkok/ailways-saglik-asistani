// Asistan yanıtlarını GÜVENLİ biçimde biçimlendirir. HTML asla yorumlanmaz;
// yalnızca paragraf, "- " madde listesi, "1. " numaralı liste ve **kalın** desteklenir
// ve tüm metin textContent ile eklenir (XSS'e karşı).

function appendInline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const strong = document.createElement('strong');
      strong.className = 'font-semibold';
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else {
      parent.append(document.createTextNode(part));
    }
  }
}

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function renderRichText(text) {
  const fragment = document.createDocumentFragment();
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    let list = null;
    let paragraph = null;

    for (const line of lines) {
      const bullet = line.match(BULLET);
      const numbered = !bullet && line.match(NUMBERED);
      if (bullet || numbered) {
        const tag = bullet ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag.toLowerCase());
          list.className = bullet ? 'list-disc space-y-1 pl-5' : 'list-decimal space-y-1 pl-5';
          fragment.append(list);
        }
        const item = document.createElement('li');
        appendInline(item, (bullet ?? numbered)[1]);
        list.append(item);
        paragraph = null;
      } else {
        list = null;
        if (!paragraph) {
          paragraph = document.createElement('p');
          fragment.append(paragraph);
        } else {
          paragraph.append(document.createElement('br'));
        }
        appendInline(paragraph, line.trim());
      }
    }
  }
  return fragment;
}
