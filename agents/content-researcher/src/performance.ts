import fs from 'fs';

const PERFORMANCE_FILE = './performance.json';

interface TokenRecord {
  date: string;
  tokens: number;
}

function loadData(): TokenRecord[] {
  if (!fs.existsSync(PERFORMANCE_FILE)) return [];
  const data = fs.readFileSync(PERFORMANCE_FILE, 'utf-8');
  return JSON.parse(data);
}

function saveData(data: TokenRecord[]) {
  fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(data, null, 2));
}

export function trackTokens(tokens: number) {
  const data = loadData();
  const today = new Date().toISOString().split('T')[0]!;
  const existing = data.find(d => d.date === today);
  let record: TokenRecord;
  if (!existing) {
    record = { date: today, tokens: 0 };
    data.push(record);
  } else {
    record = existing;
  }
  record.tokens += tokens;
  saveData(data);
}

export function resetWeekly() {
  const now = new Date();
  if (now.getDay() === 0) { // Sunday
    saveData([]); // reset to empty
  }
}

export function getWeeklyReport(): string {
  const data = loadData();
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  const startDate = sunday.toISOString().split('T')[0]!;
  const weekData = data.filter(d => d.date >= startDate);
  const total = weekData.reduce((sum, d) => sum + d.tokens, 0);
  const breakdown = weekData.map(d => `${d.date}: ${d.tokens}`).join('\n');
  return `Weekly Token Usage Report:\nTotal: ${total}\nBreakdown:\n${breakdown}`;
}
