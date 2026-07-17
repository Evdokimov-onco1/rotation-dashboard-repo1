// Тестовые данные прототипа — из Приложения В ТЗ (график 2025/26, исправленный)

export interface Week { num: number; start: string; end: string; label: string; }
export interface Curator { id: string; fio: string; note?: string; }
export interface Unit {
  id: string; short: string; name: string;
  rule: "auto" | "manual"; color: string; candidates: string[];
}
export interface Resident { id: string; fio: string; }
export interface Block {
  id: string; residentId: string; unitId: string;
  from: number; to: number; curatorId: string | null;
}

export const WEEKS: Week[] = [
  { num: 1, start: "2025-09-01", end: "2025-09-05", label: "01.09–05.09" },
  { num: 2, start: "2025-09-08", end: "2025-09-12", label: "08.09–12.09" },
  { num: 3, start: "2025-09-15", end: "2025-09-19", label: "15.09–19.09" },
  { num: 4, start: "2025-09-22", end: "2025-09-26", label: "22.09–26.09" },
  { num: 5, start: "2025-09-29", end: "2025-10-03", label: "29.09–03.10" },
  { num: 6, start: "2025-10-06", end: "2025-10-10", label: "06.10–10.10" },
  { num: 7, start: "2025-10-13", end: "2025-10-17", label: "13.10–17.10" },
  { num: 8, start: "2025-10-20", end: "2025-10-24", label: "20.10–24.10" },
  { num: 9, start: "2025-10-27", end: "2025-10-31", label: "27.10–31.10" },
  { num: 10, start: "2025-11-03", end: "2025-11-07", label: "03.11–07.11" },
  { num: 11, start: "2025-11-17", end: "2025-11-21", label: "17.11–21.11" },
  { num: 12, start: "2025-11-24", end: "2025-11-28", label: "24.11–28.11" },
  { num: 13, start: "2025-12-01", end: "2025-12-05", label: "01.12–05.12" },
  { num: 14, start: "2025-12-08", end: "2025-12-12", label: "08.12–12.12" },
  { num: 15, start: "2025-12-15", end: "2025-12-19", label: "15.12–19.12" },
  { num: 16, start: "2025-12-22", end: "2025-12-30", label: "22.12–30.12" },
  { num: 17, start: "2026-02-11", end: "2026-02-20", label: "11.02–20.02" },
  { num: 18, start: "2026-02-24", end: "2026-02-27", label: "24.02–27.02" },
  { num: 19, start: "2026-03-02", end: "2026-03-06", label: "02.03–06.03" },
  { num: 20, start: "2026-03-10", end: "2026-03-13", label: "10.03–13.03" },
  { num: 21, start: "2026-03-16", end: "2026-03-20", label: "16.03–20.03" },
  { num: 22, start: "2026-03-23", end: "2026-03-27", label: "23.03–27.03" },
  { num: 23, start: "2026-03-30", end: "2026-04-03", label: "30.03–03.04" },
  { num: 24, start: "2026-04-06", end: "2026-04-10", label: "06.04–10.04" },
  { num: 25, start: "2026-04-20", end: "2026-04-24", label: "20.04–24.04" },
  { num: 26, start: "2026-04-27", end: "2026-04-30", label: "27.04–30.04" },
  { num: 27, start: "2026-05-04", end: "2026-05-08", label: "04.05–08.05" },
  { num: 28, start: "2026-05-12", end: "2026-05-15", label: "12.05–15.05" },
  { num: 29, start: "2026-05-18", end: "2026-05-22", label: "18.05–22.05" },
  { num: 30, start: "2026-05-25", end: "2026-05-29", label: "25.05–29.05" },
  { num: 31, start: "2026-06-01", end: "2026-06-05", label: "01.06–05.06" },
  { num: 32, start: "2026-06-08", end: "2026-06-11", label: "08.06–11.06" },
  { num: 33, start: "2026-06-15", end: "2026-06-19", label: "15.06–19.06" },
  { num: 34, start: "2026-06-22", end: "2026-06-26", label: "22.06–26.06" },
  { num: 35, start: "2026-06-29", end: "2026-07-04", label: "29.06–04.07" },
];

export const CURATORS: Curator[] = [
  { id: "ronzin", fio: "Ронзин Андрей Владимирович", note: "ОО №1 (С8)" },
  { id: "dalgatov", fio: "Далгатов Камиль Далгатович", note: "ОО №2 (С8)" },
  { id: "hasan", fio: "Хасан Амер", note: "ОО №3 (С8)" },
  { id: "kobzev", fio: "Кобзев Дмитрий Сергеевич", note: "ОО №4 (С8)" },
  { id: "levitskiy", fio: "Левицкий Александр Васильевич", note: "ОО №5 (С8)" },
  { id: "umyarov", fio: "Умяров Тимур Романович", note: "онкоурология, А22/К57" },
  { id: "karpovich", fio: "Карпович Марина Петровна", note: "маммология/репродукт., А22/К57" },
  { id: "panshin", fio: "Паньшин Александр Геннадьевич", note: "А22, ОО №3" },
  { id: "khalzova", fio: "Хальзова Мария Сергеевна", note: "А22, ОО №1" },
  { id: "shestakov", fio: "Шестаков Алексей Владимирович", note: "С8, зав. ЦАОП" },
  { id: "sekhina", fio: "Сехина Ольга Викторовна", note: "ДС ПЛТ №1 (С8)" },
  { id: "petukhov", fio: "Петухов Евгений Алексеевич", note: "радиотерапевтич. отд." },
  { id: "fedorinov", fio: "Федоринов Денис Сергеевич", note: "ООПЛТ" },
  { id: "lummer", fio: "Луммер Кирилл Борисович", note: "интервенц. УЗИ" },
  { id: "donchenko", fio: "Донченко Наталья Сергеевна", note: "лучевая диагностика" },
  { id: "kovaleva", fio: "Ковалева Алина Сергеевна", note: "лучевая диагностика" },
];

export const UNITS: Unit[] = [
  { id: "oo1", short: "ОО1", name: "Онкологическое отделение №1", rule: "auto", color: "#3b6ea5", candidates: ["ronzin"] },
  { id: "oo2", short: "ОО2", name: "Онкологическое отделение №2", rule: "auto", color: "#4f9d55", candidates: ["dalgatov"] },
  { id: "oo3", short: "ОО3", name: "Онкологическое отделение №3", rule: "auto", color: "#c26a2e", candidates: ["hasan"] },
  { id: "oo4", short: "ОО4", name: "Онкологическое отделение №4", rule: "auto", color: "#8a63b8", candidates: ["kobzev"] },
  { id: "oo5", short: "ОО5", name: "Онкологическое отделение №5", rule: "auto", color: "#2ca6a4", candidates: ["levitskiy"] },
  { id: "caop_gmu", short: "ЦАОП г/м/у", name: "ЦАОП гинеколог/маммолог/уролог", rule: "manual", color: "#c9508f", candidates: ["umyarov", "karpovich"] },
  { id: "caop_obsh", short: "ЦАОП общ", name: "ЦАОП общий онколог", rule: "manual", color: "#d94f4f", candidates: ["panshin", "khalzova", "shestakov"] },
  { id: "ht_ds", short: "ХТ ДС", name: "Химиотерапия дневной стационар (С8)", rule: "auto", color: "#b8952e", candidates: ["sekhina"] },
  { id: "lt", short: "ЛТ", name: "Лучевая терапия", rule: "auto", color: "#5f7d8c", candidates: ["petukhov"] },
  { id: "ld", short: "ЛД", name: "Лучевая диагностика", rule: "manual", color: "#7d9a3c", candidates: ["donchenko", "kovaleva"] },
  { id: "ooplt", short: "ООПЛТ", name: "ООПЛТ (круглосуточная химиотерапия)", rule: "auto", color: "#6b7280", candidates: ["fedorinov"] },
  { id: "iuzi", short: "иУЗИ", name: "Интервенционная ультрасонография", rule: "auto", color: "#3c8f7c", candidates: ["lummer"] },
];

export const RESIDENTS: Resident[] = [
  { id: "buh", fio: "Бухурова Элона Руслановна" },
  { id: "kaz", fio: "Казоря Дарья Михайловна" },
  { id: "mir", fio: "Мирзаханов Рамиль Ирекович" },
  { id: "orl", fio: "Орлов Артем Игоревич" },
  { id: "suh", fio: "Сухоносова Софья Алексеевна" },
  { id: "shid", fio: "Шидаева Милена Михайловна" },
  { id: "shis", fio: "Шишкин Андрей Романович" },
  { id: "yar", fio: "Ярахмедова Людмила Маратовна" },
];

let n = 0;
const b = (residentId: string, unitId: string, from: number, to: number, curatorId: string | null = null): Block => {
  n += 1;
  return { id: "b" + n, residentId, unitId, from, to, curatorId };
};

// auto-подразделения получают куратора автоматически; manual — null (⚠️), кроме двух демонстрационно назначенных
export const INITIAL_BLOCKS: Block[] = [
  // Бухурова
  b("buh", "caop_gmu", 1, 6, "karpovich"), // демо: назначено
  b("buh", "oo1", 7, 10, "ronzin"),
  b("buh", "oo5", 11, 14, "levitskiy"),
  b("buh", "ld", 15, 16, null),
  b("buh", "oo2", 17, 20, "dalgatov"),
  b("buh", "ht_ds", 21, 26, "sekhina"),
  b("buh", "oo3", 27, 30, "hasan"),
  b("buh", "oo4", 31, 34, "kobzev"),
  // Казоря
  b("kaz", "ooplt", 1, 6, "fedorinov"),
  b("kaz", "caop_obsh", 7, 12, "shestakov"), // демо: назначено
  b("kaz", "oo2", 13, 16, "dalgatov"),
  b("kaz", "oo5", 17, 20, "levitskiy"),
  b("kaz", "oo1", 21, 24, "ronzin"),
  b("kaz", "ht_ds", 25, 30, "sekhina"),
  b("kaz", "oo3", 31, 34, "hasan"),
  // Мирзаханов
  b("mir", "oo4", 1, 4, "kobzev"),
  b("mir", "lt", 5, 10, "petukhov"),
  b("mir", "ht_ds", 11, 16, "sekhina"),
  b("mir", "caop_obsh", 17, 22, null),
  b("mir", "oo1", 23, 26, "ronzin"),
  b("mir", "oo2", 27, 30, "dalgatov"),
  b("mir", "ooplt", 31, 35, "fedorinov"),
  // Орлов
  b("orl", "oo3", 1, 4, "hasan"),
  b("orl", "ht_ds", 5, 10, "sekhina"),
  b("orl", "lt", 11, 16, "petukhov"),
  b("orl", "ooplt", 17, 22, "fedorinov"),
  b("orl", "oo2", 23, 26, "dalgatov"),
  b("orl", "oo4", 27, 30, "kobzev"),
  b("orl", "caop_obsh", 31, 35, null),
  // Сухоносова
  b("suh", "oo1", 1, 4, "ronzin"),
  b("suh", "caop_gmu", 5, 10, null),
  b("suh", "ooplt", 11, 16, "fedorinov"),
  b("suh", "oo5", 17, 20, "levitskiy"),
  b("suh", "oo3", 21, 24, "hasan"),
  b("suh", "caop_obsh", 25, 30, null),
  b("suh", "oo2", 31, 34, "dalgatov"),
  // Шидаева (13–16: ОО №2 — исправлено)
  b("shid", "caop_obsh", 1, 6, null),
  b("shid", "ooplt", 7, 12, "fedorinov"),
  b("shid", "oo2", 13, 16, "dalgatov"),
  b("shid", "oo1", 17, 20, "ronzin"),
  b("shid", "oo4", 21, 24, "kobzev"),
  b("shid", "lt", 25, 30, "petukhov"),
  b("shid", "oo5", 31, 34, "levitskiy"),
  // Шишкин
  b("shis", "oo5", 1, 4, "levitskiy"),
  b("shis", "oo4", 5, 8, "kobzev"),
  b("shis", "caop_gmu", 9, 14, null),
  b("shis", "iuzi", 15, 16, "lummer"),
  b("shis", "lt", 17, 22, "petukhov"),
  b("shis", "oo3", 23, 26, "hasan"),
  b("shis", "oo1", 27, 30, "ronzin"),
  b("shis", "ht_ds", 31, 35, "sekhina"),
  // Ярахмедова
  b("yar", "oo2", 1, 4, "dalgatov"),
  b("yar", "oo3", 5, 8, "hasan"),
  b("yar", "oo4", 9, 12, "kobzev"),
  b("yar", "oo1", 13, 16, "ronzin"),
  b("yar", "caop_gmu", 17, 22, null),
  b("yar", "ooplt", 23, 28, "fedorinov"),
  b("yar", "lt", 29, 34, "petukhov"),
];

export const weekByNum = (num: number) => WEEKS.find((w) => w.num === num)!;
export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;
export const curatorById = (id: string) => CURATORS.find((c) => c.id === id);
export const residentById = (id: string) => RESIDENTS.find((r) => r.id === id)!;

export const fmtD = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
};
export const blockRangeLabel = (bl: Block) =>
  `недели ${bl.from}–${bl.to} (${fmtD(weekByNum(bl.from).start)} – ${fmtD(weekByNum(bl.to).end)})`;

export const shortFio = (fio: string) => {
  const p = fio.split(" ");
  return p.length >= 3 ? `${p[0]} ${p[1][0]}.${p[2][0]}.` : fio;
};
