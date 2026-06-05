// Node script to fetch the Firestore document via REST and check for Base64 image strings
// Usage: node scripts/check_firestore.js

const fs = require('fs');
const path = require('path');

async function main() {
  const cfgPath = path.join(__dirname, '..', 'firebase-config.js');
  if (!fs.existsSync(cfgPath)) {
    console.error('firebase-config.js not found at', cfgPath);
    process.exit(2);
  }
  const cfgText = fs.readFileSync(cfgPath, 'utf8');
  const m = cfgText.match(/window\.FIREBASE_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!m) {
    console.error('Could not extract FIREBASE_CONFIG from firebase-config.js');
    process.exit(2);
  }
  const objText = m[1];
  let config;
  try {
    config = eval('(' + objText + ')');
  } catch (e) {
    console.error('Failed to eval FIREBASE_CONFIG:', e);
    process.exit(2);
  }

  const docPathMatch = cfgText.match(/window\.FIREBASE_DOC_PATH\s*=\s*"([^"]+)"/);
  const docPath = docPathMatch ? docPathMatch[1] : 'sistemas/firebase';

  const projectId = config.projectId;
  if (!projectId) {
    console.error('projectId not found in FIREBASE_CONFIG');
    process.exit(2);
  }

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  console.log('Fetching', url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.error('Failed fetching document. Status:', res.status, text);
      process.exit(3);
    }
    const data = await res.json();
    // Firestore REST returns fields in `data.fields`
    const docFields = data.fields || {};

    // Convert Firestore Value objects to plain JS
    function convertValue(v) {
      if (v.stringValue !== undefined) return v.stringValue;
      if (v.integerValue !== undefined) return Number(v.integerValue);
      if (v.doubleValue !== undefined) return Number(v.doubleValue);
      if (v.booleanValue !== undefined) return v.booleanValue;
      if (v.timestampValue !== undefined) return v.timestampValue;
      if (v.mapValue !== undefined) {
        const obj = {};
        const map = v.mapValue.fields || {};
        for (const k of Object.keys(map)) obj[k] = convertValue(map[k]);
        return obj;
      }
      if (v.arrayValue !== undefined) {
        const arr = v.arrayValue.values || [];
        return arr.map(convertValue);
      }
      if (v.nullValue !== undefined) return null;
      return v; // fallback
    }

    const plain = {};
    for (const k of Object.keys(docFields)) plain[k] = convertValue(docFields[k]);

    // We expect state or state.landingContent
    const state = plain.state || plain;
    const landing = state.landingContent || state.landing || null;

    function findStrings(obj) {
      const strings = [];
      function recur(x, path) {
        if (typeof x === 'string') strings.push({ path, value: x });
        else if (Array.isArray(x)) x.forEach((v, i) => recur(v, path + '[' + i + ']'));
        else if (x && typeof x === 'object') Object.keys(x).forEach(k => recur(x[k], path ? path + '.' + k : k));
      }
      recur(obj, '');
      return strings;
    }

    const target = landing || plain;
    const strings = findStrings(target);

    const dataImage = strings.filter(s => s.value.startsWith('data:image/'));
    if (dataImage.length === 0) {
      console.log('No data:image/ Base64 inline images found in the document (checked landingContent/state).');
    } else {
      console.warn('Found inline Base64 images:', dataImage.slice(0, 10));
      if (dataImage.length > 10) console.warn('...and', dataImage.length - 10, 'more');
    }

    // Also print any suspicious very long strings (>1000 chars) which might be large Base64
    const longStrings = strings.filter(s => s.value.length > 1000);
    if (longStrings.length) {
      console.warn('Found very long string values (length > 1000):');
      for (const ls of longStrings.slice(0, 10)) console.warn(ls.path, 'len=', ls.value.length);
    }

    // Print summary of some image URL fields, if present
    const imageUrls = strings.filter(s => /url|image|photo|hero|split/i.test(s.path) && s.value.startsWith('http'));
    if (imageUrls.length) {
      console.log('Example image URLs found (up to 20):');
      for (const it of imageUrls.slice(0, 20)) console.log(it.path, it.value);
    }

    // Dump a small summary
    console.log('\nDocument fetch summary:');
    console.log('Document name:', data.name);
    console.log('Total string values found in landing/state:', strings.length);

  } catch (err) {
    console.error('Error fetching document:', err);
    process.exit(4);
  }
}

main();
