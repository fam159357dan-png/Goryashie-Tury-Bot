// Проверка бота без Telegram и без Tourvisor: node check.mjs
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { astanaDay } from './stats.js';
import { kompasUrl } from './kompas.js';
import worker, { parseHot, scrapeHot, matches, tourInfo, groupHotels, conceptMessages, paramMessages, hotFits, orderResorts, channelDigest, channelNews, hotBlock, channelHot, channelWeather, resortOfDay, channelEvening, managerRows } from './worker.js';

// Tourvisor в проверке подменён: ответ как у настоящего поиска (Турция/Таиланд, 4 отеля с разным рейтингом)
let tvMode = 'ok';
let memberStatus = 'member';
const tvHotels = { 1: ['ALPHA RESORT', '4.8', 5], 2: ['BETA HOTEL', '4.2', 4], 3: ['GAMMA INN', '3.8', 3], 4: ['LOW HOTEL', '3.2', 3] };
const tvResult = { data: {
  status: { progress: 100, finished: 1 },
  block: [{ hotel: [1, 2, 3, 4].map(id => ({ id, price: id * 100000, tour: [{ dt: '2026-12-06', nt: 7, pr: id * 100000, ml: 3 }, { dt: '2026-12-08', nt: 8, pr: id * 100000 + 5000, ml: 3 }] })) }],
  decode: { hotels: Object.fromEntries(Object.entries(tvHotels).map(([id, [name, rating, stars]]) => [id, { name, rating, stars: String(stars), region: 'Пхукет' }])), meal: { 3: { nameshort: 'BB - Завтрак' } } },
} };
const tvCalls = [];
// карточки открытой страницы горящих туров (как у Tourvisor): со скидкой, она же повторно (в другой вкладке страницы), без скидки и без звёзд
const hotCard = ({ code, date, nights, meal, disc = '', price, name, loc, opt }) => `<a href="https://tourvisor.ru/search.php?ts_dosearch=1&amp;s_form_mode=0&amp;s_nights_from=${nights}&amp;s_nights_to=${nights}&amp;s_regular=1&amp;x_hotel_codes=${code}&amp;s_j_date_from=${date}&amp;s_j_date_to=${date}&amp;s_adults=2&amp;s_flyfrom=59&amp;s_country=13&amp;s_currency=3&amp;s_meal=${meal}" class="trv-hot-tours-2__item" target="_blank" onclick="x">
  <div class="trv-hot-tours-2__item-img" style="background-image: url('https://static.tourvisor.ru/hotel_pics/main400/${code}.jpg')"><span class="trv-hot-tours-2__item-rating"><span class="trv-hot-tours-2__item-score" title="Рейтинг">4.0</span></span></div>
  <div class="trv-hot-tours-2__item-body">${disc}<div class="trv-hot-tours-2__item-price">${price} <div class="trv-currency">KZT</div></div><div class="trv-hot-tours-2__item-name">${name} </div>
  <div class="trv-hot-tours-2__item-location">${loc}</div><div class="trv-hot-tours-2__item-options">${opt}</div></div></a>`;
const sale = '<div class="trv-hot-tours-2__item-discount"><div class="trv-hot-tours-2__item-percent">-28%</div><div class="trv-hot-tours-2__item-old-price">654 857 <div class="trv-currency">KZT</div></div></div>';
const c1 = { code: 3117, date: '12.11.2026', nights: 6, meal: 3, disc: sale, price: '471 497', name: '4* Sanya Yuhai &amp; Spa', loc: 'Китай, Хайнань', opt: '12 ноя, 6 нч, Завтрак, 2 взр.' };
const HOT_HTML = '<div class="trv-hot-tours-2-sections">' + hotCard(c1) + hotCard(c1) + hotCard({ code: 555, date: '20.12.2026', nights: 9, meal: 7, price: '300 000', name: 'Apartments Palm', loc: 'ОАЭ', opt: '20 дек, 9 нч, Все Включено, 2 взр.' }) + '</div>';

const sent = [];
let msgId = 100;
const rss = items => `<rss><channel><title>Лента</title>${items.map(([t, l]) => `<item><title><![CDATA[${t}]]></title><link>${l}</link></item>`).join('')}</channel></rss>`;
globalThis.fetch = async (url, o) => {
  if (url.includes('marine-api')) return Response.json({ current: { sea_surface_temperature: 29.6 } });
  if (url.includes('open-meteo')) return Response.json({ daily: url.includes('latitude=51.17')
    ? { temperature_2m_max: [-3.4], temperature_2m_min: [-10.2], weather_code: [73] }
    : { temperature_2m_max: [31.2], temperature_2m_min: [25], weather_code: [1] } });
  if (url.includes('api.github.com')) return Response.json([{ commit: { author: { date: '2026-11-12T08:00:00Z' }, message: 'Кнопка Назад на каждом шаге\n\nподробности' } }]);
  if (url.includes('kursiv')) return new Response(rss([['SCAT возьмет в лизинг два Boeing', 'https://k/1'], ['Курс тенге вырос', 'https://k/2']]));
  if (url.includes('inform.kz')) return new Response('down', { status: 500 });
  if (url.includes('tourdom')) return new Response(rss([['Анапа получила статус курорта', 'https://t/1'], ['SCAT возьмет в лизинг два Boeing', 'https://t/dup']]));
  if (url.includes('goryashchie-tury')) { // открытая страница горящих туров: по два одинаковых и разных тура, у Атырау страница не открылась
    if (url.includes('departure=75')) return new Response('Forbidden', { status: 403 });
    return new Response(HOT_HTML);
  }
  if (url.includes('tourvisor.ru')) {
    tvCalls.push(url);
    if (tvMode === 'down') return new Response('Forbidden', { status: 403 });
    if (url.includes('type=country')) return Response.json({ lists: url.includes('cndep=98') ? { countries: { country: [{ id: 78 }, { id: 2 }] } } : {} }); // у Петропавловска — только Казахстан и Таиланд (для проверки)
    if (url.includes('listdev')) return Response.json({ lists: { regions: { region: [
      { id: 6, name: 'Пхукет', parentid: 0 }, { id: 5, name: 'Паттайя', parentid: 0 }, { id: 600, name: 'Патонг', parentid: 6 }, { id: 7, name: 'Самуи', parentid: 0 }, { id: 8, name: 'Краби', parentid: 0 }, { id: 9, name: 'Чианг Май', parentid: 0 }] } } });
    return Response.json(url.includes('modsearch') ? { result: { requestid: 1 } } : tvResult);
  }
  if (o.body instanceof FormData) { // фото файлом
    const f = Object.fromEntries(o.body.entries());
    sent.push({ method: url.split('/').pop(), upload: true, size: f.photo.size, caption: f.caption, chat_id: f.chat_id, reply_markup: JSON.parse(f.reply_markup) });
    return Response.json({ ok: true, result: { message_id: ++msgId } });
  }
  sent.push({ method: url.split('/').pop(), ...JSON.parse(o.body) });
  if (url.endsWith('getChatMemberCount')) return Response.json({ ok: true, result: 123 });
  if (url.endsWith('getChatMember')) return Response.json({ ok: true, result: { status: memberStatus } });
  return Response.json({ ok: true, result: { message_id: ++msgId } });
};
const kv = new Map();
const env = { BOT_TOKEN: 't', UPDATE_SECRET: 's', TG_SECRET: 'g', ADMIN_CODE: 'abc', CHANNEL_ID: '@ch', CONTACT_URL: 'https://wa.me/1', POSTS_PER_UPDATE: '2', TOUR_LINK: 'https://tourcart.ru/#tvofferid={id}',
  TOURS: { get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k), list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) } };
const pending = [];
const ctx = { waitUntil: p => pending.push(p) };
const post = async (path, body, headers) => { const r = await worker.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body), headers }), env, ctx); await Promise.all(pending.splice(0)); return r; };
const TG = { 'x-telegram-bot-api-secret-token': 'g' };

// даты вылета — через 5 дней от сегодня, чтобы попадать в «Ближайшие 2 недели»
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const soon = new Date(Date.now() + 5 * 864e5);
const when = `${soon.getUTCDate()} ${MONTHS[soon.getUTCMonth()]}`;
const t = (id, country, price, oldPrice, nights) => ({ id, country, price, oldPrice, title: 'Тур ' + id, descr: `5*, ${country}${country === 'Таиланд' ? ', Пхукет' : ''} из Астаны ${when} на ${nights} ночей, Завтрак.`, discount: '', img: 'https://img/' + id + '.jpg' });
const items = [t('1', 'Таиланд', 500000, 600000, 14), t('2', 'Таиланд', 300000, 600000, 7), t('3', 'ОАЭ', 400000, 410000, 7)];

// разбор даты, ночей и питания; январь при текущем ноябре — следующий год
const info = tourInfo({ descr: '5*, Таиланд из Астаны 9 января на 12 ночей, Завтрак.' }, new Date(Date.UTC(2026, 10, 8)));
assert.equal(info.date.toISOString().slice(0, 10), '2027-01-09');
assert.equal(info.nights, 12);
assert.equal(info.meal, 1); // Завтрак
assert.equal(tourInfo({ descr: '5*, ОАЭ из Астаны 8 ноября на 10 ночей, Без питания. Отель' }).meal, 0);
assert.equal(tourInfo({ descr: '5*, Турция из Астаны 8 ноября на 7 ночей, Ультра всё включено. Отель' }).meal, 5);
assert.equal(tourInfo({ descr: '5*, Таиланд, Пхукет из Астаны 18 ноября на 14 ночей. Пхукет является…' }).meal, undefined);

// группы рейтинга: 4,5–5 / 4–4,5 / 3,7–4; ниже 3,7 не показываем
const g = groupHotels([{ rating: 4.5 }, { rating: 4.49 }, { rating: 4.0 }, { rating: 3.99 }, { rating: 3.7 }, { rating: 3.69 }].map((h, i) => ({ ...h, price: i })));
assert.deepEqual(g.map(x => x.hotels.map(h => h.rating)), [[4.5], [4.49, 4.0], [3.99, 3.7]]);

// приём туров и публикация в канал
assert.equal((await post('/update', { items }, { 'x-secret': 'bad' })).status, 403);
let r = await (await post('/update', { updated: '2026-11-07T04:00:00Z', items }, { 'x-secret': 's' })).json();
assert.deepEqual(r, { saved: 3, posted: 2 });
assert.deepEqual(sent.map(m => m.caption.match(/Тур \d/)[0]), ['Тур 2', 'Тур 1']); // самая большая скидка первой
sent.length = 0;
r = await (await post('/update', { items }, { 'x-secret': 's' })).json();
assert.equal(r.posted, 1); // уже опубликованные не повторяются
// туры с городами: сбор по городам заменяет всё, в канал по одному — только Астана; старая сборка без города обновляет только Астану
const tc = (id, dep) => ({ ...t(id, 'ОАЭ', 399000, 400000, 7), dep, descr: `4*, ОАЭ из ${dep} ${when} на 7 ночей, Завтрак.` });
r = await (await post('/update', { updated: '2026-11-11T04:00:00Z', items: [tc('21', 'Алматы'), tc('22', 'Алматы'), tc('23', 'Шымкент')] }, { 'x-secret': 's' })).json();
assert.deepEqual(r, { saved: 3, posted: 0 });
assert.deepEqual(JSON.parse(kv.get('tours')).items.map(x => x.dep), ['Алматы', 'Алматы', 'Шымкент']);
r = await (await post('/update', { updated: '2026-11-11T05:00:00Z', items }, { 'x-secret': 's' })).json(); // без dep = Астана
assert.equal(r.saved, 6); // Алматы и Шымкент остались, Астана добавилась
assert.deepEqual(JSON.parse(kv.get('tours')).items.map(x => x.dep), ['Алматы', 'Алматы', 'Шымкент', 'Астана', 'Астана', 'Астана']);
// бот: горящие только выбранного аэропорта
assert.deepEqual(matches({ d: '2', c: '*', f: '*', n: '3', p: '5', r: '' }, JSON.parse(kv.get('tours')), new Date()).map(x => x.id), ['21', '22']);
sent.length = 0;

// владелец бота регистрируется для сообщений о сбоях
sent.length = 0;
await post('/tg', { message: { chat: { id: 99 }, message_id: 1, text: '/admin abc' } }, TG);
assert.equal(kv.get('admin'), '99');

// /start: постоянная кнопка внизу + первый шаг подбора
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 1, text: '/start' } }, TG);
assert.deepEqual(sent[0].reply_markup.keyboard, [[{ text: '🔎 Подобрать тур за 1 минуту', style: 'primary' }]]);
assert.ok(sent[0].reply_markup.input_field_placeholder.length <= 64); // лимит Telegram
assert.match(sent[1].text, /Из какого аэропорта/); // первым шагом — аэропорт вылета (РК)
assert.deepEqual(sent[1].reply_markup.inline_keyboard.flat().map(b => b.text), ['Астана', 'Петропавловск', 'Алматы', 'Шымкент', 'Караганда', 'Актау', 'Актобе', 'Атырау', 'Костанай', 'Кызылорда', 'Семей', 'Туркестан', 'Уральск', 'Усть-Каменогорск']);
let wizardId = msgId;

// клиент проходит шаги, нажимая кнопки
const press = async label => {
  const btn = sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.text === label);
  assert.ok(btn, 'нет кнопки ' + label);
  sent.length = 0;
  await post('/tg', { callback_query: { id: 'q', data: btn.callback_data, message: { chat: { id: 7 }, message_id: wizardId } } }, TG);
  assert.ok(btn.callback_data.length <= 64);
};
const NB = '◀️ Назад';
const texts = () => sent.at(-1).reply_markup.inline_keyboard.flat().map(b => b.text);
const wizard = async (city = 'Астана') => {
  const hot = city === 'Астана' ? '🔥 ' : '';
  // порядок вопросов: вылет → страна → курорт → бюджет → туристы → звёздность → рейтинг → пляж → питание → ночи → период
  await press(city); assert.match(sent.at(-1).text, /Вылет: [^\n]*\n\n👉 Выберите страну/);
  const countryBtns = texts().filter(t => t !== NB);
  assert.ok(!countryBtns.some(c => ['Чехия', 'Франция', 'Сербия', 'Словения', 'Венгрия', 'Россия', 'Австрия', 'Италия', 'Сингапур'].includes(c.replace('🔥 ', '')))); // скрытые страны не показываются
  if (city === 'Астана') assert.equal(countryBtns.length, 35); // «Любая страна» + 43 страны Tourvisor без девяти скрытых
  else if (tvMode === 'ok') assert.deepEqual(countryBtns, ['Любая страна', 'Таиланд', 'Казахстан']); // только страны этого аэропорта
  if (city === 'Астана') assert.deepEqual(countryBtns.slice(1, 8), [hot + 'Таиланд', hot + 'ОАЭ', 'Турция', 'Египет', 'Китай', 'Вьетнам', 'Азербайджан']); // 🔥 — есть горящие туры
  await press(hot + 'Таиланд'); assert.match(sent.at(-1).text, /Выберите курорты/);
  // курорты: сначала с горящими (в проверке 🔥 Пхукет), затем популярные по списку, затем остальные; галочки, до трёх
  assert.deepEqual(texts(), ['⬜ ' + hot + 'Пхукет', '⬜ Паттайя', '⬜ Самуи', '⬜ Краби', '⬜ Чианг Май', 'Готово ▶', 'Любой курорт', NB]);
  assert.match(sent.at(-1).text, /Выберите курорты — до 3, выбрано 0 \(🔥 — есть горящие туры\)/);
  await press('⬜ ' + hot + 'Пхукет'); assert.match(sent.at(-1).text, /выбрано 1/);
  await press('⬜ Самуи'); assert.match(sent.at(-1).text, /выбрано 2/);
  assert.deepEqual(texts().slice(0, 3), ['✅ ' + hot + 'Пхукет', '⬜ Паттайя', '✅ Самуи']);
  await press('✅ Самуи'); assert.match(sent.at(-1).text, /выбрано 1/); // отметку можно снять
  await press('Готово ▶'); assert.match(sent.at(-1).text, /Курорт: Пхукет\n\n👉 Какой бюджет/);
  assert.deepEqual(texts(), ['500–800 тыс. ₸', '800 тыс. – 1,2 млн ₸', '1,2–2 млн ₸', '2–2,5 млн ₸', '2,5–3 млн ₸', 'от 3 млн ₸', 'Любой бюджет', NB]); // линейка бюджета
  await press('Любой бюджет'); assert.match(sent.at(-1).text, /Бюджет: любой\n\n👉 Сколько взрослых/);
  await press('2'); assert.match(sent.at(-1).text, /Сколько детей/);
  await press('1'); assert.match(sent.at(-1).text, /Возраст 1-го ребёнка/);
  assert.deepEqual(texts(), ['до 2', ...Array.from({ length: 16 }, (_, i) => String(i + 2)), NB]);
  await press('5'); assert.match(sent.at(-1).text, /Звёздность отеля/);
  assert.deepEqual(texts(), ['⬜ ⭐⭐⭐⭐⭐ 5 звёзд', '⬜ ⭐⭐⭐⭐ 4 звезды', '⬜ ⭐⭐⭐ 3 звезды', 'Готово ▶', 'Любая звёздность', NB]);
  await press('Любая звёздность'); assert.match(sent.at(-1).text, /Рейтинг отеля/);
  assert.deepEqual(texts(), ['⬜ 🟢 4,5–5', '⬜ 🟡 4–4,5', '⬜ 🟠 3,7–4', 'Готово ▶', 'Любой рейтинг', NB]); // кнопки «От 3,7 до 5» нет
  await press('Любой рейтинг'); assert.match(sent.at(-1).text, /Пляж/);
  assert.deepEqual(texts(), ['⬜ Любой пляж', '⬜ Первая береговая линия', '⬜ Песчаный пляж', 'Готово ▶', NB]);
  await press('Готово ▶'); assert.match(sent.at(-1).text, /Питание/); // ничего не отмечено — любой пляж
  assert.deepEqual(texts(), ['Любое', 'Без питания', 'BB - Только завтрак', 'HB - Завтрак, Ужин', 'FB - Полный Пансион', 'AI - Все Включено', 'UAI - Ультра Все Включено', NB]);
  await press('BB - Только завтрак'); assert.match(sent.at(-1).text, /Сколько ночей/);
  await press('6–9 ночей'); assert.match(sent.at(-1).text, /Когда хотите лететь/);
  await press('Ближайшие 2 недели');
};
await wizard();

// итог: запрос → «ищу» (удаляется) → 3 подборки по рейтингу → горящий тур → кнопка заявки
assert.match(sent[1].text, /Вылет: Астана\nСтрана: Таиланд\nКурорт: Пхукет\nБюджет: любой\nТуристы: 2 взр\. \+ 1 ребёнок \(5 лет\)\nЗвёздность: любая\nРейтинг: любой\nПляж: любой\nПитание: BB - Только завтрак \(или лучше\)\nНочей: 6–9\nПериод: Ближайшие 2 недели/);
assert.match(sent[2].text, /🟦{10}\n👇 <b>ПОСЛЕДНЯЯ ПОДБОРКА НИЖЕ<\/b>/u); // синий разделитель перед каждой свежей подборкой
assert.match(sent[3].text, /Ищу туры/);
assert.equal(sent[4].method, 'deleteMessage');
// в поиск Tourvisor ушли параметры клиента
const sq = new URL(tvCalls.find(u => u.includes('modsearch'))).searchParams;
assert.deepEqual(['country', 'regions', 'departure', 'adults', 'child', 'childage1', 'meal', 'nightsfrom', 'nightsto', 'currency'].map(k => sq.get(k)), ['2', '6', '59', '2', '1', '5', '3', '6', '9', '3']);
const groups = sent.slice(5, 8);
// оформление «Цветные метки»: линии, 🟢/🟡/🟠 по рейтингу, ⭐ по числу звёзд
assert.deepEqual(groups.map(m => m.text.match(/(🟢|🟡|🟠) <b>РЕЙТИНГ ([^<]+)</).slice(1).join(' ')), ['🟢 4,5–5', '🟡 4–4,5', '🟠 3,7–4']);
assert.match(groups[0].text, /^━+\n🟢 <b>РЕЙТИНГ 4,5–5<\/b>\n━+\n1️⃣ <b>ALPHA RESORT<\/b>\n {6}⭐⭐⭐⭐⭐  🟢 <b>4,8<\/b>\n {6}Пхукет · 06\.12 · 7 ноч\. · BB - Завтрак\n {6}💰 <b>100\s000 ₸<\/b>/);
assert.match(groups[1].text, /BETA HOTEL[\s\S]*⭐⭐⭐⭐  🟡 <b>4,2/);
assert.match(groups[2].text, /GAMMA INN[\s\S]*⭐⭐⭐  🟠 <b>3,8/);
assert.match(sent.at(-1).text, /В стоимость включено:<\/b> перелёт, трансфер, проживание, питание по концепции, медстраховка, тур код\n⏱ <b>Стоимость актуальна на момент поиска<\/b>/);
assert.ok(!sent.some(m => /LOW HOTEL/.test(m.text || ''))); // рейтинг 3,2 не показываем
// кнопка отеля ведёт на этот отель, дату и ночи; последняя — все варианты группы
const hb = new URL(groups[0].reply_markup.inline_keyboard[0][0].url).searchParams;
assert.deepEqual([hb.get('x_hotel_codes'), hb.get('s_j_date_from'), hb.get('s_nights_from')], ['1', '06.12.2026', '7']);
// последняя кнопка каждой подборки — «Написать менеджеру» (вместо «Все варианты на Tourvisor») с запросом клиента
for (const g of groups) {
  const last = g.reply_markup.inline_keyboard.at(-1)[0];
  assert.equal(last.text, '📩 Написать менеджеру');
  assert.match(decodeURIComponent(last.url), /^https:\/\/wa\.me\/1\?text=Здравствуйте! Подберите, пожалуйста, тур\.\nВылет: Астана/);
}
assert.ok(!sent.some(m => JSON.stringify(m.reply_markup || '').includes('Все варианты')));
const photos = sent.filter(m => m.method === 'sendPhoto');
assert.deepEqual(photos.map(m => m.caption.match(/Тур \d/)[0]), ['Тур 2']);
assert.deepEqual(photos[0].reply_markup.inline_keyboard[0].map(b => b.url), ['https://tourcart.ru/#tvofferid=2', 'https://wa.me/1?text=' + encodeURIComponent('Здравствуйте! Хочу забронировать тур: Тур 2')]);
assert.match(decodeURIComponent(sent.at(-1).reply_markup.inline_keyboard[0][0].url), /Подберите, пожалуйста, тур\.\nВылет: Астана\nСтрана: Таиланд\nКурорт: Пхукет\nБюджет: любой\nТуристы: 2 взр\./);
assert.deepEqual(sent.at(-1).reply_markup.inline_keyboard.flat().map(b => b.text), ['📩 Отправить запрос менеджеру']); // кнопки «Подобрать тур» здесь нет
assert.ok(!/Подобрать тур/.test(sent.at(-1).text));
// второй поиск идёт с фильтром Tourvisor «Только для взрослых» (services=48): в общую выдачу самых дешёвых отелей такие отели почти не попадают
const mq = tvCalls.filter(u => u.includes('modsearch')).map(u => new URL(u).searchParams);
assert.deepEqual(mq.map(q => q.get('services')), [null, '3', null, '3']);
// питание «Только завтрак и лучше»: Tourvisor не отдаёт «Ультра всё включено», поэтому его ищем отдельно (питание 9) — те же основной поиск и концепция
assert.deepEqual(mq.map(q => q.get('meal')), ['3', '3', '9', '9']);
// // в проверке едут с ребёнком: «Мини-клуб»; для взрослых — 48
const cmsg = sent.find(m => /ДЕТСКАЯ КОНЦЕПЦИЯ/.test(m.text || ''));
assert.match(cmsg.text, /🟢 <b>РЕЙТИНГ 4,5–5<\/b>\n─+\n/); // тонкое подчёркивание под названием подгруппы
assert.match(cmsg.text, /🌟 <b>ПЯТЬ ЗВЁЗД<\/b>\n─+\n/);
const resultIds = [msgId - 11, ...Array.from({ length: 9 }, (_, i) => msgId - 8 + i)]; // 3 по рейтингу, 3 по звёздности, раздел концепции (из отдельного поиска), фото тура, кнопка заявки
assert.deepEqual(sent.slice(8, 11).map(g => g.text.match(/РЕЙТИНГ [d,–]+|ПЯТЬ ЗВЁЗД|ЧЕТЫРЕ ЗВЕЗДЫ|ТРИ ЗВЕЗДЫ|КОНЦЕПЦИЯ/)?.[0]), ['ПЯТЬ ЗВЁЗД', 'ЧЕТЫРЕ ЗВЕЗДЫ', 'ТРИ ЗВЕЗДЫ']); // нет «взрослых» отелей — раздела концепции нет
const hx = [{ name: 'A', stars: 5, rating: 4.6, price: 1, adult: true, date: '06.12.2026', nights: 7, meal: 'BB', region: 'X' }, { name: 'B', stars: 4, rating: 4.2, price: 2, kids: true, date: '06.12.2026', nights: 7, meal: 'BB', region: 'X' }];
const cm = k => conceptMessages({ k, a: '2', ages: [], c: '0', n: '1', p: '0', f: '*', r: '', d: '0' }, new Date('2026-11-12'), hx);
const adultMsg = cm('0'), kidsMsg = cm('2');
assert.equal(adultMsg.length, 1); // всё в одном разделе одним сообщением
assert.ok(!/ЧЕТЫРЕ|>B</.test(adultMsg[0].text)); // в разделе только отели этой концепции
assert.match(adultMsg[0].text, /^━+\n🔞 <b>ВЗРОСЛАЯ КОНЦЕПЦИЯ 16\+ \/ 18\+<\/b>\n━+\n🟢 <b>РЕЙТИНГ 4,5–5<\/b>[\s\S]*🌟 <b>ПЯТЬ ЗВЁЗД<\/b>/);
assert.match(kidsMsg[0].text, /ДЕТСКАЯ КОНЦЕПЦИЯ[\s\S]*РЕЙТИНГ 4–4,5[\s\S]*ЧЕТЫРЕ ЗВЕЗДЫ/);
assert.deepEqual(conceptMessages({ k: '0' }, new Date(), [{ stars: 3, rating: 4, price: 1 }]), []); // нет отелей концепции — раздела нет

// «Подобрать тур» начинает новую подборку, а готовая остаётся (хранятся последние три)
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 55, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
assert.ok(!sent.some(m => m.method === 'deleteMessages'));
assert.match(sent[0].text, /Из какого аэропорта/);
assert.equal(sent.length, 1); // без повторного приветствия
wizardId = msgId;

// тот же запрос повторно — берётся из сохранённого, Tourvisor не дёргаем
tvCalls.length = 0;
await wizard();
assert.equal(tvCalls.filter(u => !u.includes('listdev')).length, 0); // списки стран и курортов — не поиск

// Tourvisor заблокировал: клиенту — ссылки, владельцу — сообщение о сбое
for (const k of kv.keys()) if (k.startsWith('q3:')) kv.delete(k); // убираем сохранённые результаты поиска
tvMode = 'down';
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 60, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
wizardId = msgId;
await wizard();
const alert = sent.find(m => m.chat_id === '99');
assert.match(alert.text, /Поиск Tourvisor не сработал/);
const links = sent.find(m => /Подборки по рейтингу/.test(m.text || ''));
assert.deepEqual(links.reply_markup.inline_keyboard.map(r => r[0].text), ['⭐ Рейтинг 4,5 и выше', '⭐ Рейтинг 4,0 и выше', '⭐ Рейтинг 3,5 и выше']);
const lq = new URL(links.reply_markup.inline_keyboard[0][0].url).searchParams;
assert.equal(lq.get('s_region_to'), '6'); // Пхукет
assert.deepEqual(['s_rating', 's_country', 's_flyfrom', 's_adults', 's_child', 's_child_age_1', 's_meal'].map(k => lq.get(k)), ['5', '2', '59', '2', '1', '5', '3']);
const day = s => Date.UTC(...s.split('.').reverse().map((v, i) => (i === 1 ? v - 1 : +v)));
assert.ok((day(lq.get('s_j_date_to')) - day(lq.get('s_j_date_from'))) / 864e5 <= 20); // лимит Tourvisor — 21 день
// второй сбой подряд — владельцу повторно не пишем (не чаще раза в 6 часов)
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 61, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
wizardId = msgId;
await wizard();
assert.ok(!sent.some(m => m.chat_id === '99'));

// другой город вылета: Петропавловск (98) уходит в ссылки и в поиск; горящих из кабинета (только Астана) нет
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 62, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
wizardId = msgId;
await wizard('Петропавловск');
assert.match(sent[1].text, /Вылет: Петропавловск/);
assert.equal(new URL(sent.find(m => /Подборки по рейтингу/.test(m.text || '')).reply_markup.inline_keyboard[0][0].url).searchParams.get('s_flyfrom'), '98');
assert.ok(!sent.some(m => m.method === 'sendPhoto'));
assert.match(sent.at(-1).text, /Горящих туров по этим параметрам сейчас нет/);
tvMode = 'ok'; tvCalls.length = 0;
for (const k of kv.keys()) if (k.startsWith('q3:')) kv.delete(k);
sent.length = 0;
await post('/tg', { message: { chat: { id: 7 }, message_id: 63, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
wizardId = msgId;
await wizard('Петропавловск');
assert.equal(new URL(tvCalls.find(u => u.includes('modsearch'))).searchParams.get('departure'), '98');

// подборка дня для канала: все страны вместе, топ-3 самых дешёвых в группах рейтинга и звёздности
const fake = async w => [
  { id: 10 + +w.c, name: 'TOP ' + w.c, rating: 4.7, stars: 5, region: 'Курорт', price: 900000 + +w.c, date: '20.11.2026', nights: 7, meal: 'AI' },
  { id: 20 + +w.c, name: 'MID ' + w.c, rating: 4.1, stars: 4, region: 'Курорт', price: 500000 + +w.c, date: '20.11.2026', nights: 7, meal: 'BB' },
  { id: 30 + +w.c, name: 'LOW ' + w.c, rating: 3.8, stars: 3, region: 'Курорт', price: 300000 + +w.c, date: '20.11.2026', nights: 7, meal: 'RO' },
];
const failEgypt = async w => (w.c === '1' ? Promise.reject(new Error('нет ответа')) : fake(w)); // Египет не ответил — остальные страны есть
const d = await channelDigest(env, new Date(), failEgypt);
assert.match(d.text, /ПОДБОРКА ДНЯ/);
assert.match(d.text, /👥 2 взрослых · 📅 вылет в ближайшие 2 недели · 🌙 6–9 ночей\n✅ <b>В стоимость включено:<\/b> перелёт, трансфер, проживание, питание по концепции, медстраховка, тур код\n⏱ <b>Стоимость актуальна на момент публикации<\/b>/);
assert.equal((d.text.match(/<a href=/g) || []).length, 21); // 6 групп × 3 отеля + 3 горящих
// самый дешёвый из 4,5+ — Турция (+0)
assert.match(d.text, /🟢 <b>РЕЙТИНГ 4,5–5<\/b>\n━+\n1️⃣ <b><a href="[^"]+">TOP 0<\/a><\/b>\n {6}⭐⭐⭐⭐⭐  🟢 <b>4,7<\/b>\n {6}Турция, Курорт/);
assert.ok(!/Египет/.test(d.text));
assert.match(d.text, /🌟 <b>ПЯТЬ ЗВЁЗД<\/b>\n━+\n1️⃣ [^\n]*TOP 0/);
assert.ok(d.text.replace(/<[^>]+>/g, '').length < 4096); // лимит длины сообщения Telegram
assert.match(d.text, /🔥 <b>ГОРЯЩИЕ<\/b>\n━+\n1️⃣ <b><a href="https:\/\/tourcart\.ru\/#tvofferid=2">Тур 2<\/a><\/b>/); // самая большая скидка (50%) первой

// горящие в подборке: вылет не раньше чем через 2 дня; название отеля берётся из описания
const day0 = new Date();
const desc = (days, hotel) => { const x = new Date(Date.now() + days * 864e5); return `5*, ОАЭ из Астаны ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} на 9 ночей, Завтрак. ${hotel} одно здание`; };
const hotEnv = { TOUR_LINK: 'https://tourcart.ru/#tvofferid={id}', TOURS: { get: async () => JSON.stringify({ items: [
  { id: 'a', country: 'ОАЭ', title: 'Завтра', descr: desc(1, 'TOMORROW HOTEL 5*'), price: 100, oldPrice: 1000, discount: '-90%' },
  { id: 'b', country: 'ОАЭ', title: 'Скоро', descr: desc(3, 'W DUBAI THE PALM 5*'), price: 500, oldPrice: 1000, discount: '-50%' },
] }) } };
const hb2 = await hotBlock(hotEnv, day0);
assert.ok(!/TOMORROW/.test(hb2)); // через 1 день — не берём
assert.match(hb2, /1️⃣ <b><a href="https:\/\/tourcart\.ru\/#tvofferid=b">W DUBAI THE PALM 5\*<\/a><\/b>\n {6}ОАЭ · вылет Астана · \d\d\.\d\d · 9 ноч\. · BB - Только завтрак\n {6}💰 <b>500 ₸<\/b> <s>1\s000 ₸<\/s> <b>-50%<\/b>/);

// вечерние «Горящие»: топ-5, кнопка, пусто → null
const hot = await channelHot(hotEnv, day0);
// горящие в канале — со всех городов (до 2 с города)
const multi = { ...hotEnv, TOURS: { get: async () => JSON.stringify({ items: [
  ...['a1', 'a2', 'a3'].map((id, i) => ({ id, dep: 'Алматы', country: 'ОАЭ', title: id, descr: desc(3, 'ALMATY HOTEL ' + id + ' 5*'), price: 100 + i, oldPrice: 1000, discount: '-90%' })),
  { id: 'k1', dep: 'Шымкент', country: 'Египет', title: 'k1', descr: desc(4, 'SHYM HOTEL 4*'), price: 500, oldPrice: 1000, discount: '-50%' },
] }) } };
const mb = await hotBlock(multi, day0, 8, 2);
assert.equal((mb.match(/<a href/g) || []).length, 3); // Алматы — 2 лучших, плюс Шымкент
assert.match(mb, /ОАЭ · вылет Алматы/);
assert.match(mb, /Египет · вылет Шымкент/);
assert.ok(!/ALMATY HOTEL a3/.test(mb));
assert.match((await hotBlock(multi, day0, 8, 8)), /4️⃣ <b><a href="[^"]+tvofferid=k1/); // четвёртая карточка нумеруется
assert.match(hot.text, /^🔥 <b>ГОРЯЩИЕ ТУРЫ · [^<]+<\/b>[\s\S]*тур код[\s\S]*Стоимость актуальна на момент публикации[\s\S]*W DUBAI THE PALM 5\*/);
assert.equal(hot.kb[0][0].text, '🔎 Подобрать тур за 1 минуту');
assert.equal(await channelHot({ TOURS: { get: async () => null } }, day0), null);

// погода: Астана и курорт дня в сезоне, температура воды, на сколько теплее
const nov = new Date(Date.UTC(2026, 10, 10, 10));
assert.ok(['Пхукет', 'Шарм-эль-Шейх', 'Дубай', 'Фукуок', 'Санья (Хайнань)', 'Мальдивы', 'Гоа', 'Хургада'].includes(resortOfDay(nov)[0]));
assert.ok(!['Анталья', 'Шри-Ланка'].includes(resortOfDay(nov)[0])); // в ноябре там не сезон
const wr = await channelWeather(env, nov);
assert.match(wr.text, /АСТАНА<\/b>\n━+\n {6}🌨 снег\n {6}днём <b>-3°<\/b> · ночью -10°/);
assert.match(wr.text, /🌤 малооблачно\n {6}днём <b>\+31°<\/b> · ночью \+25°\n {6}🌊 вода <b>\+30°<\/b>/);
assert.match(wr.text, /Там на <b>35°<\/b> теплее, чем в Астане/);
assert.equal(wr.kb[0][0].url, 'https://t.me/HotToursAstana_bot');
assert.equal(wr.kb[0][0].text, '🔎 Подобрать тур за 1 минуту'); // кнопка в погоде
assert.equal(d.kb[0][0].url, 'https://t.me/HotToursAstana_bot');
for (const b of [d.kb[0][0]]) assert.equal(b.text, '🔎 Подобрать тур за 1 минуту'); // кнопка в подборке дня
await assert.rejects(channelDigest(env, new Date(), async () => { throw new Error('блок'); }), /ни одна страна не ответила/);

// новости: только про туризм, без повторов, источник указан; второй раз — ничего нового
const n1 = await channelNews(env);
assert.match(n1, /SCAT возьмет в лизинг два Boeing<\/a> — Курсив/);
assert.match(n1, /Анапа получила статус курорта<\/a> — TourDom/);
assert.ok(!/Курс тенге/.test(n1)); // не про туризм
assert.equal((n1.match(/SCAT/g) || []).length, 1); // одинаковый заголовок из двух лент — один раз
assert.equal(await channelNews(env), null);

// вечерний пост: картинка от нейросети + призыв; каждый день другой креатив; без картинки — пост текстом
const aiPrompts = [];
const aiEnv = { ...env, AI: { run: async (model, o) => { aiPrompts.push(o.prompt); return { image: btoa('FAKEJPEG') }; } } };
const ev1 = await channelEvening(aiEnv, new Date(Date.UTC(2026, 10, 10, 15)));
const ev2 = await channelEvening(aiEnv, new Date(Date.UTC(2026, 10, 11, 15)));
assert.equal(new TextDecoder().decode(ev1.image), 'FAKEJPEG');
assert.ok(ev1.text !== ev2.text && aiPrompts[0] !== aiPrompts[1]); // креативы меняются
assert.match(ev1.text, /^🌅 <b>[^<]+<\/b>\n\n[\s\S]*Иллюстрация создана нейросетью/);
assert.ok(ev1.text.replace(/<[^>]+>/g, '').length < 1024); // лимит подписи к фото
assert.equal(ev1.kb[0][0].url, 'https://t.me/HotToursAstana_bot');
assert.equal(ev1.kb[0][0].text, '🔎 Подобрать тур за 1 минуту'); // кнопка в вечернем посте
assert.match(decodeURIComponent(ev1.kb[1][0].url), /^https:\/\/wa\.me\/1\?text=Здравствуйте! Хочу в отпуск: /);
sent.length = 0;
const rr = await worker.fetch(new Request('https://x/run?job=evening', { method: 'POST', headers: { 'x-secret': 's' } }), aiEnv, ctx);
assert.equal((await rr.json()).ok, true);
assert.deepEqual([sent[0].method, sent[0].upload, sent[0].chat_id, sent[0].size > 0], ['sendPhoto', true, '@ch', true]);
// to=admin — предпросмотр только владельцу, не в канал
sent.length = 0;
await worker.fetch(new Request('https://x/run?job=evening&to=admin', { method: 'POST', headers: { 'x-secret': 's' } }), aiEnv, ctx);
assert.deepEqual([sent[0].method, sent[0].chat_id], ['sendPhoto', '99']);
sent.length = 0;
kv.delete('alerted'); // ограничение «не чаще раза в 6 часов» в этой проверке уже сработало
const noAi ={ ...env, AI: { run: async () => { throw new Error('лимит нейросети'); } } };
await worker.fetch(new Request('https://x/run?job=evening', { method: 'POST', headers: { 'x-secret': 's' } }), noAi, ctx);
assert.equal(sent.find(m => m.chat_id === '@ch').method, 'sendMessage'); // пост вышел без картинки
assert.match(sent.find(m => m.chat_id === '99').text, /Вечерняя картинка не нарисовалась/); // владельцу — сообщение

// удаление ошибочного поста бота в канале
sent.length = 0;
await worker.fetch(new Request('https://x/run?job=delete&id=24', { method: 'POST', headers: { 'x-secret': 's' } }), env, ctx);
assert.deepEqual([sent[0].method, sent[0].chat_id, sent[0].message_id], ['deleteMessage', '@ch', 24]);
assert.equal(sent.length, 1);

// горящие туры с открытой страницы Tourvisor: разбор карточек, повтор отбрасывается
const ph = parseHot(HOT_HTML, 'Астана');
assert.equal(ph.length, 2);
assert.deepEqual([ph[0].id, ph[0].title, ph[0].stars, ph[0].country, ph[0].price, ph[0].oldPrice, ph[0].discount, ph[0].rating], ['p3117-12.11.2026-6-3', 'Sanya Yuhai & Spa', 4, 'Китай', 471497, 654857, '-28%', 4]);
assert.match(ph[0].link, /^https:\/\/tourvisor\.ru\/search\.php\?.*x_hotel_codes=3117.*s_flyfrom=59.*s_currency=3/); // ссылка на поиск этого отеля
assert.equal(ph[0].img, 'https://static.tourvisor.ru/hotel_pics/main400/3117.jpg');
const pi = tourInfo(ph[0], new Date(Date.UTC(2026, 10, 11)));
assert.deepEqual([pi.date.toISOString().slice(0, 10), pi.nights, pi.meal], ['2026-11-12', 6, 1]); // бот находит дату, ночи, питание в описании
assert.deepEqual([ph[1].stars, ph[1].oldPrice, ph[1].discount, ph[1].country, tourInfo(ph[1]).meal], [0, 0, '', 'ОАЭ', 4]); // без звёзд и без скидки
// обход городов: Атырау не открылся — остаются прежние туры города (их нет), остальные 13 обновились
kv.set('tours', JSON.stringify({ items: [{ ...ph[0], id: 'old', dep: 'Атырау' }] }));
const sr = await scrapeHot(env);
assert.deepEqual(sr, { saved: 2 * 13 + 1, failed: 1 });
const stored = JSON.parse(kv.get('tours')).items;
assert.equal(stored.filter(x => x.dep === 'Атырау').length, 1); // сохранились
assert.equal(stored.filter(x => x.dep === 'Алматы').length, 2);
// через /run и по расписанию (cron 14:00 UTC — сначала обновление туров, потом пост)
sent.length = 0;
const rs = await (await worker.fetch(new Request('https://x/run?job=scrape', { method: 'POST', headers: { 'x-secret': 's' } }), env, ctx)).json();
assert.equal(rs.ok, true); assert.equal(sent.length, 0); // в канал ничего не публикуется

assert.equal((await worker.fetch(new Request('https://x/update', { method: 'OPTIONS' }), env, ctx)).headers.get('access-control-allow-origin'), 'https://pro.tourvisor.ru');
assert.equal((await worker.fetch(new Request('https://x/.git/HEAD'), env, ctx)).status, 404);
// старый клиент без «Старт»: при первом нажатии кнопки бот один раз присылает синюю клавиатуру, дальше — нет
sent.length = 0;
await post('/tg', { message: { chat: { id: 99 }, message_id: 1, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
assert.equal(sent.filter(m => m.reply_markup?.keyboard?.[0]?.[0]?.style === 'primary').length, 1);
sent.length = 0;
await post('/tg', { message: { chat: { id: 99 }, message_id: 2, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
assert.equal(sent.filter(m => m.reply_markup?.keyboard).length, 0);
// доступ: до 29 ноября — всем, с 30 ноября — только подписчикам канала
sent.length = 0;
await post('/tg', { message: { chat: { id: 55 }, from: { id: 55 }, message_id: 1, text: '/start' } }, TG);
assert.ok(!sent.some(m => m.method === 'getChatMember')); // сейчас бот открыт, подписку не проверяем
env.OPEN_UNTIL = '2000-01-01T00:00:00+05:00'; // имитируем «30 ноября наступило»
memberStatus = 'left';
sent.length = 0;
await post('/tg', { message: { chat: { id: 56 }, from: { id: 56 }, message_id: 1, text: '/start' } }, TG);
assert.deepEqual(sent.map(m => m.method), ['getChatMember', 'sendMessage']);
assert.match(sent[1].text, /Далее бот доступен бесплатно только подписчикам Telegram-канала[\s\S]*https:\/\/t\.me\/ch/);
assert.equal(sent[1].reply_markup.inline_keyboard[0][0].url, 'https://t.me/ch');
sent.length = 0;
await post('/tg', { callback_query: { id: 'c', data: 'chk', from: { id: 56 }, message: { chat: { id: 56 }, message_id: 9 } } }, TG);
assert.equal(sent.find(m => m.method === 'answerCallbackQuery').show_alert, true); // не подписан — подсказка, подбор не начинаем
assert.ok(!sent.some(m => m.method === 'sendMessage'));
memberStatus = 'member';
sent.length = 0;
await post('/tg', { callback_query: { id: 'c', data: 'chk', from: { id: 56 }, message: { chat: { id: 56 }, message_id: 9 } } }, TG);
assert.match(sent.find(m => m.method === 'sendMessage').text, /аэропорт/); // подписан — начинается подбор
delete env.OPEN_UNTIL;
// хранятся последние три подборки: при четвёртой самая старая удаляется; начатая и брошенная подборка не считается
const pick = async (chat, id) => { sent.length = 0; await post('/tg', { message: { chat: { id: chat }, from: { id: chat }, message_id: id, text: '🔎 Подобрать тур за 1 минуту' } }, TG); };
kv.set('kb2:801', '1'); kv.set('kb2:802', '1'); kv.set('kb2:803', '1');
kv.set('m:801', JSON.stringify([{ ids: [1], done: true }, { ids: [2], done: true }, { ids: [3], done: true }]));
await pick(801, 90);
assert.deepEqual(sent.filter(m => m.method === 'deleteMessages').map(m => m.message_ids), [[1]]); // четвёртая — первая удалена
assert.deepEqual(JSON.parse(kv.get('m:801')).map(x => x.ids[0]), [2, 3, 90]); // остались последние три, четвёртая начата
kv.set('m:802', JSON.stringify([{ ids: [5], done: true }, { ids: [6], done: false }]));
await pick(802, 91);
assert.deepEqual(sent.filter(m => m.method === 'deleteMessages').map(m => m.message_ids), [[6]]); // брошенная убрана, готовая осталась
assert.deepEqual(JSON.parse(kv.get('m:802')).map(x => x.ids[0]), [5, 91]);
kv.set('m:803', JSON.stringify([7, 8])); // старый формат записи
await pick(803, 92);
assert.ok(!sent.some(m => m.method === 'deleteMessages'));
assert.deepEqual(JSON.parse(kv.get('m:803')).map(x => x.ids[0]), [7, 92]);
assert.equal(typeof (await worker.scheduled({ cron: '0 9 * * *' }, env, ctx)), 'undefined'); // расписание без ночной очистки: расписания и посты прежние
await Promise.all(pending.splice(0));
// «Назад» на каждом шаге: ответы до него сохраняются, заново начинать не нужно
kv.set('kb2:900', '1');
const step9 = async data => { sent.length = 0; await post('/tg', { callback_query: { id: 'b', data, message: { chat: { id: 900 }, message_id: 5 } } }, TG); return sent.find(m => m.method === 'editMessageText'); };
const norm9 = t => t.replace('🔥 ', ''); // горящие в проверке зависят от данных — значок 🔥 при поиске кнопки не учитываем
const btn9 = (m, label) => m.reply_markup.inline_keyboard.flat().find(b => norm9(b.text) === norm9(label));
const go9 = async (m, label) => { const b = btn9(m, label); assert.ok(b, 'нет кнопки ' + label + ' среди: ' + m.reply_markup.inline_keyboard.flat().map(x => x.text).join(' / ') + ' | ' + m.text); return step9(b.callback_data); };
let m9 = await step9('w:::::::::');
assert.ok(!btn9(m9, NB)); // на первом шаге (аэропорт) назад не нужен
m9 = await go9(m9, 'Астана'); assert.match(m9.text, /Выберите страну/);
m9 = await go9(m9, NB); assert.match(m9.text, /Из какого аэропорта/); // из выбора страны назад к аэропорту
m9 = await go9(m9, 'Астана');
m9 = await go9(m9, '🔥 Таиланд'); assert.match(m9.text, /Выберите курорты/);
m9 = await go9(m9, NB); assert.match(m9.text, /Выберите страну/); // из курортов назад к стране
m9 = await go9(m9, 'Любая страна'); assert.match(m9.text, /Какой бюджет/); // у «любой страны» курортов нет — шаг пропущен
m9 = await go9(m9, NB); assert.match(m9.text, /Выберите страну/); // из бюджета сразу к стране, не зависает
m9 = await go9(m9, '🔥 Таиланд');
m9 = await go9(m9, '⬜ 🔥 Пхукет'); m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Курорт: Пхукет\n\n👉 Какой бюджет/);
m9 = await go9(m9, NB); assert.match(m9.text, /выбрано 0/); // из бюджета назад к курортам, выбор сброшен
m9 = await go9(m9, 'Любой курорт'); assert.match(m9.text, /Курорт: любой\n\n👉 Какой бюджет/);
m9 = await go9(m9, '500–800 тыс. ₸'); assert.match(m9.text, /Бюджет: 500–800 тыс\. ₸\n\n👉 Сколько взрослых/);
m9 = await go9(m9, NB); assert.match(m9.text, /Какой бюджет/); // назад к бюджету
m9 = await go9(m9, 'Любой бюджет');
m9 = await go9(m9, '2'); assert.match(m9.text, /Сколько детей/);
m9 = await go9(m9, NB); assert.match(m9.text, /Сколько взрослых/);
m9 = await go9(m9, '2');
m9 = await go9(m9, '2'); assert.match(m9.text, /Возраст 1-го/);
m9 = await go9(m9, '4'); assert.match(m9.text, /Возраст 2-го/);
m9 = await go9(m9, NB); assert.match(m9.text, /Возраст 1-го/); // убран последний ответ (возраст 1-го ребёнка)
m9 = await go9(m9, NB); assert.match(m9.text, /Сколько детей/); // с возраста 1-го — назад к числу детей
m9 = await go9(m9, 'Без детей'); assert.match(m9.text, /Звёздность отеля/);
m9 = await go9(m9, NB); assert.match(m9.text, /Сколько детей/); // без детей: из звёздности назад к числу детей
m9 = await go9(m9, 'Без детей');
// звёздность: можно выбрать несколько вариантов и нажать «Готово»
const mk = m => m.reply_markup.inline_keyboard.flat().map(b => b.text).slice(0, 3);
m9 = await go9(m9, '⬜ ⭐⭐⭐⭐ 4 звезды'); assert.deepEqual(mk(m9), ['⬜ ⭐⭐⭐⭐⭐ 5 звёзд', '✅ ⭐⭐⭐⭐ 4 звезды', '⬜ ⭐⭐⭐ 3 звезды']);
m9 = await go9(m9, '⬜ ⭐⭐⭐⭐⭐ 5 звёзд'); assert.deepEqual(mk(m9), ['✅ ⭐⭐⭐⭐⭐ 5 звёзд', '✅ ⭐⭐⭐⭐ 4 звезды', '⬜ ⭐⭐⭐ 3 звезды']);
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Звёздность: 5★ и 4★\n\n👉 Рейтинг отеля/);
m9 = await go9(m9, NB); assert.match(m9.text, /Звёздность отеля/);
assert.deepEqual(mk(m9), ['⬜ ⭐⭐⭐⭐⭐ 5 звёзд', '⬜ ⭐⭐⭐⭐ 4 звезды', '⬜ ⭐⭐⭐ 3 звезды']); // выбор сброшен
m9 = await go9(m9, '⬜ ⭐⭐⭐⭐ 4 звезды');
m9 = await go9(m9, '✅ ⭐⭐⭐⭐ 4 звезды'); assert.deepEqual(mk(m9), ['⬜ ⭐⭐⭐⭐⭐ 5 звёзд', '⬜ ⭐⭐⭐⭐ 4 звезды', '⬜ ⭐⭐⭐ 3 звезды']); // отметку можно снять
m9 = await go9(m9, 'Любая звёздность'); assert.match(m9.text, /Звёздность: любая/);
m9 = await go9(m9, NB);
m9 = await go9(m9, '⬜ ⭐⭐⭐⭐ 4 звезды');
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Звёздность: 4★\n\n👉 Рейтинг отеля/);
// рейтинг: тоже несколько групп
m9 = await go9(m9, '⬜ 🟢 4,5–5'); m9 = await go9(m9, '⬜ 🟡 4–4,5');
assert.deepEqual(mk(m9), ['✅ 🟢 4,5–5', '✅ 🟡 4–4,5', '⬜ 🟠 3,7–4']);
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Рейтинг: 4,5–5 и 4–4,5\n\n👉 Пляж/);
m9 = await go9(m9, NB); assert.match(m9.text, /Рейтинг отеля/);
m9 = await go9(m9, '⬜ 🟢 4,5–5');
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Рейтинг: 4,5–5\n\n👉 Пляж/);
// пляж: три галочки «Любой пляж», «Первая береговая линия», «Песчаный пляж» — любые сочетания, в том числе «любой» + «первая линия»
const marks = m => m.reply_markup.inline_keyboard.flat().map(b => b.text).slice(0, 3);
assert.deepEqual(marks(m9), ['⬜ Любой пляж', '⬜ Первая береговая линия', '⬜ Песчаный пляж']);
m9 = await go9(m9, '⬜ Любой пляж'); m9 = await go9(m9, '⬜ Первая береговая линия');
assert.deepEqual(marks(m9), ['✅ Любой пляж', '✅ Первая береговая линия', '⬜ Песчаный пляж']); // вместе выбираются
m9 = await go9(m9, '⬜ Песчаный пляж'); assert.deepEqual(marks(m9), ['✅ Любой пляж', '✅ Первая береговая линия', '✅ Песчаный пляж']);
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Пляж: любая линия, первая береговая линия, песчаный пляж\n[\s\S]*Питание/);
m9 = await go9(m9, NB); assert.match(m9.text, /Пляж \(отметьте нужное/); // назад к пляжу, выбор сброшен
assert.deepEqual(marks(m9), ['⬜ Любой пляж', '⬜ Первая береговая линия', '⬜ Песчаный пляж']);
m9 = await go9(m9, '⬜ Первая береговая линия');
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Пляж: первая береговая линия\n[\s\S]*Питание/);
m9 = await go9(m9, NB);
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Пляж: любой\n[\s\S]*Питание/); // ничего не отмечено — любой пляж
m9 = await go9(m9, NB);
m9 = await go9(m9, '⬜ Песчаный пляж');
m9 = await go9(m9, 'Готово ▶'); assert.match(m9.text, /Пляж: песчаный пляж\n[\s\S]*Питание/);
m9 = await go9(m9, NB);
m9 = await go9(m9, 'Готово ▶');
m9 = await go9(m9, 'Любое'); assert.match(m9.text, /Сколько ночей/);
m9 = await go9(m9, NB); assert.match(m9.text, /Питание/);
m9 = await go9(m9, 'Любое');
m9 = await go9(m9, '6–9 ночей'); assert.match(m9.text, /Когда хотите лететь/);
m9 = await go9(m9, NB); assert.match(m9.text, /Сколько ночей/);

// подборка «по параметрам»: не больше 5 отелей + 1 отель концепции; все «любые» — подборка как раньше
const HH = (id, stars, rating, price, extra = {}) => ({ id, name: 'H' + id, stars, rating, price, date: '06.12.2026', nights: 7, meal: 'BB', region: 'X', ...extra });
const wp = { k: '0', a: '2', ages: [], st: '5', rt: '0', by: '0', c: '0', n: '1', p: '0', f: '*', r: '*', d: '0', bd: '*' };
const hs5 = [HH(1, 5, 4.8, 900000), HH(2, 5, 4.6, 800000), HH(3, 5, 4.2, 700000), HH(4, 4, 4.7, 600000), HH(5, 5, 4.9, 1000000), HH(6, 5, 4.55, 950000), HH(7, 5, 4.5, 970000), HH(8, 5, 4.6, 1100000)];
const lead9 = 'https://wa.me/1?text=x';
let pm = paramMessages(wp, new Date('2026-11-12'), hs5, [HH(9, 5, 4.6, 1200000, { adult: true }), HH(2, 5, 4.6, 800000)], lead9);
assert.equal(pm.length, 2); // 5 отелей + 1 дополнительный вариант концепции
assert.match(pm[0].text, /^━+\n🎯 <b>ПОДБОРКА ПО ВАШИМ ПАРАМЕТРАМ<\/b>\n━+\n/);
assert.deepEqual([...pm[0].text.matchAll(/<b>H(\d)<\/b>/g)].map(x => x[1]), ['2', '1', '6', '7', '5']); // только 5★ с рейтингом 4,5+, самые дешёвые, не больше пяти
assert.equal(pm[0].kb.at(-1)[0].text, '📩 Написать менеджеру');
assert.match(pm[1].text, /ВЗРОСЛАЯ КОНЦЕПЦИЯ 16\+ \/ 18\+[\s\S]*<b>H9<\/b>/); // шестой: отель взрослой концепции, не повторяющий основные
pm = paramMessages({ ...wp, k: '2' }, new Date('2026-11-12'), hs5, [HH(9, 5, 4.6, 1200000, { kids: true })], lead9);
assert.match(pm[1].text, /ДЕТСКАЯ КОНЦЕПЦИЯ/); // с детьми — детская концепция
assert.equal(paramMessages(wp, new Date('2026-11-12'), hs5, [HH(9, 5, 4.6, 1200000, { adult: true })], lead9, false).length, 1); // выключено в пульте
pm = paramMessages({ ...wp, rt: '2' }, new Date('2026-11-12'), hs5, [], lead9);
assert.match(pm[0].text, /отелей не нашлось/); // ничего не подошло — подсказка и кнопка менеджеру
assert.equal(pm.length, 1);
// горящие туры: бюджет, звёздность, рейтинг
assert.deepEqual([hotFits({ bd: '0' }, { price: 400000 }), hotFits({ bd: '0' }, { price: 600000 }), hotFits({ bd: '5' }, { price: 3500000 }), hotFits({ bd: '3' }, { price: 2600000 }), hotFits({ st: '5' }, { stars: 4 }), hotFits({ rt: 'r' }, { rating: 3.5 }), hotFits({ bd: '*', st: '*', rt: '*' }, { price: 1 })], [false, true, true, false, false, false, true]);
// в Tourvisor уходят бюджет, звёздность, рейтинг и пляж; для концепции — те же фильтры + услуга «Только для взрослых»
kv.set('kb2:7', '1');
for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
tvCalls.length = 0; sent.length = 0;
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:*:*:0:2:5:0:3', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
const qs = tvCalls.filter(u => u.includes('modsearch')).map(u => Object.fromEntries(new URL(u).searchParams));
assert.equal(qs.length, 2); // основной поиск и поиск концепции
assert.deepEqual([qs[0].pricefrom, qs[0].priceto, qs[0].stars, qs[0].rating, qs[0].services], ['1200000', '2000000', '5', '5', '15,17']);
assert.equal(qs[1].services, '15,17,48');
assert.ok(sent.some(m => /ПОДБОРКА ПО ВАШИМ ПАРАМЕТРАМ/.test(m.text || '')));
assert.ok(!sent.some(m => /РЕЙТИНГ 4,5–5/.test(m.text || ''))); // это уже не три группы, а одна подборка по параметрам

// ссылки на отели ведут на сайт туроператора KOMPAS, если отель там есть; иначе — прежняя ссылка на поиск Tourvisor
assert.equal(kompasUrl('Турция', 'ARSI BLUE BEACH HOTEL (EX. KEMALHAN BEACH)'), 'https://kompastour.com/kz/rus/country/turkey/alanya/arsi_blue_beach_hotel/');
assert.equal(kompasUrl('Китай', 'Sanya New City'), 'https://kompastour.com/kz/rus/country/china/hainan/sanya_new_city/'); // пример Аслана
assert.equal(kompasUrl('Вьетнам', 'WYNDHAM GRAND PHU QUOC'), 'https://kompastour.com/kz/rus/country/vietnam/fukuok/wyndham_grand_phuquoc_resort/'); // пример Аслана: «Phu Quoc» и «phuquoc» — один отель
assert.equal(kompasUrl('Вьетнам', 'WYNDHAM GRAND PHU QUOC RESORT'), 'https://kompastour.com/kz/rus/country/vietnam/fukuok/wyndham_grand_phuquoc_resort/');
assert.equal(kompasUrl('Вьетнам', 'SELINA HOTEL (THUY NGA HOTEL)'), 'https://kompastour.com/kz/rus/country/vietnam/fukuok/selina_hotel/'); // название в скобках без «ex.»
assert.equal(kompasUrl('Турция', 'NOVIS HOTEL CLEOPATRA (EX. BILKAY)'), 'https://kompastour.com/kz/rus/country/turkey/alanya/kleopatra_bilkay_hotel/'); // по прежнему названию
assert.equal(kompasUrl('Турция', 'NO SUCH HOTEL XYZ'), null);
assert.equal(kompasUrl('Россия', 'Любой'), null); // у KOMPAS нет такой страны
const kw = { ...wp, c: '0', st: '*', rt: '*' }; // страна 0 = Турция
const km = paramMessages({ ...kw, st: '5', rt: '*' }, new Date('2026-11-12'), [HH(1, 5, 4.0, 900000, { name: 'ARSI BLUE BEACH HOTEL (EX. KEMALHAN BEACH)' }), HH(2, 5, 4.1, 950000, { name: 'NO SUCH HOTEL XYZ' })], [], lead9);
assert.equal(km[0].kb[0][0].url, 'https://kompastour.com/kz/rus/country/turkey/alanya/arsi_blue_beach_hotel/'); // отель есть у KOMPAS
assert.match(km[0].kb[1][0].url, /^https:\/\/tourvisor\.ru\/search\.php\?/); // нет у KOMPAS — поиск Tourvisor
// любая звёздность и любой рейтинг + пляж: подборка как раньше (группы), а пляж идёт фильтром в поиск
kv.set('kb2:7', '1');
for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
tvCalls.length = 0; sent.length = 0;
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:*:*:0:*:*:*:2', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
const qb = tvCalls.filter(u => u.includes('modsearch')).map(u => Object.fromEntries(new URL(u).searchParams));
assert.deepEqual([qb[0].services, qb[1].services], ['17', '17,48']); // песчаный пляж; для концепции — плюс «Только для взрослых»
assert.ok(sent.some(m => /РЕЙТИНГ 4,5–5/.test(m.text || ''))); // подборка по группам рейтинга, не «по параметрам»
assert.ok(!sent.some(m => /ПОДБОРКА ПО ВАШИМ ПАРАМЕТРАМ/.test(m.text || '')));

// несколько звёздностей и групп рейтинга: поиск на каждую звёздность, рейтинг — самый широкий из выбранных, отели подходят по любому из выбранных
for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
tvCalls.length = 0; sent.length = 0;
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:*:*:0:*:54:01:0', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
const qm = tvCalls.filter(u => u.includes('modsearch')).map(u => Object.fromEntries(new URL(u).searchParams));
assert.deepEqual(qm.map(q => q.stars || null).sort(), ['4', '5', null]); // две звёздности + поиск концепции без звёздности
assert.ok(qm.every(q => q.rating === '4')); // группы 4,5–5 и 4–4,5 → рейтинг от 4,0
assert.ok(sent.some(m => /ПОДБОРКА ПО ВАШИМ ПАРАМЕТРАМ/.test(m.text || '')));
const wm = { k: '0', a: '2', ages: [], st: '54', rt: '02', by: '0', c: '0', n: '1', p: '0', f: '*', r: '*', d: '0', bd: '*' };
pm = paramMessages(wm, new Date('2026-11-12'), [HH(1, 5, 4.8, 900000), HH(2, 4, 4.2, 800000), HH(3, 4, 3.8, 700000), HH(4, 3, 4.6, 600000), HH(5, 5, 4.2, 500000)], [], lead9);
assert.deepEqual([...pm[0].text.matchAll(/<b>H(\d)<\/b>/g)].map(x => x[1]), ['3', '1']); // 5★ и 4★; рейтинг 4,5–5 или 3,7–4; 3★ и 4,2 не подходят

// курорты: не больше трёх, порядок — горящие, популярные, остальные
let mr = await step9('w:2:2:0::1:0:*:t6.5.7:0:*:*:*:0'); // уже отмечены три курорта
assert.match(mr.text, /выбрано 3/);
const lim = await go9(mr, '⬜ Краби'); // четвёртый не добавляется
assert.match(lim?.text || mr.text, /выбрано 3/);
mr = await go9(mr, 'Готово ▶'); assert.match(mr.text, /Курорт: Пхукет, Паттайя, Самуи\n/);
assert.equal(orderResorts('Таиланд', [[1, 'Ко Чанг'], [2, 'Самуи'], [3, 'Пхукет'], [4, 'Краби']], n => n === 'Краби').map(r => r[1]).join(','), 'Краби,Пхукет,Самуи,Ко Чанг'); // горящий, потом популярные по списку, потом остальные
assert.equal(orderResorts('Остров', [[1, 'Б'], [2, 'А']], () => false).map(r => r[1]).join(','), 'Б,А'); // страны нет в списке популярных — порядок Tourvisor
// в поиск Tourvisor уходят все выбранные курорты
for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
tvCalls.length = 0; sent.length = 0;
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:*:6.5.7:0:*:*:*:0', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
assert.equal(new URL(tvCalls.find(u => u.includes('modsearch'))).searchParams.get('regions'), '6,5,7');

// правило «хранятся последние три поиска» на настоящем ходе подбора: четыре подряд сделанных поиска → первый удалён, остались три
kv.set('kb2:950', '1');
const FINAL = 'w:2:2:0::1:0:*:*:0:*:*:*:0'; // все ответы даны — запускается поиск
const doSearch = async n => {
  await post('/tg', { message: { chat: { id: 950 }, from: { id: 950 }, message_id: 1000 + n, text: '🔎 Подобрать тур за 1 минуту' } }, TG); // нажатие кнопки = начало поиска
  await post('/tg', { callback_query: { id: 'k' + n, data: FINAL, from: { id: 950 }, message: { chat: { id: 950 }, message_id: 5000 + n } } }, TG); // поиск завершён
};
const keep = () => JSON.parse(kv.get('m:950'));
sent.length = 0;
await doSearch(1); await doSearch(2); await doSearch(3);
assert.equal(keep().length, 3);
assert.ok(keep().every(x => x.done));
assert.ok(!sent.some(m => m.method === 'deleteMessages' && m.chat_id === 950)); // три поиска — ничего не удаляется
const first = keep()[0].ids;
assert.ok(first.includes(1001)); // в первом поиске — нажатие кнопки
sent.length = 0;
await doSearch(4);
const del = sent.filter(m => m.method === 'deleteMessages' && m.chat_id === 950);
assert.deepEqual(del.flatMap(m => m.message_ids).sort((a, b) => a - b), [...first].sort((a, b) => a - b)); // удалён весь первый поиск и только он
const after = keep();
assert.equal(after.length, 3); // остались три последних
assert.ok(after.every(x => x.done));
assert.ok(after[2].ids.includes(1004) && !after.some(x => x.ids.includes(1001)));
sent.length = 0;
await doSearch(5);
assert.deepEqual(sent.filter(m => m.method === 'deleteMessages' && m.chat_id === 950).flatMap(m => m.message_ids).includes(1002), true); // пятый — удалён второй
assert.equal(keep().length, 3);

// питание: «Ультра всё включено» — самое высокое, отдельного дополнительного поиска не нужно; «любое» тоже
for (const f of ['5', '*']) {
  for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
  tvCalls.length = 0;
  await post('/tg', { callback_query: { id: 'q', data: `w:2:2:0::1:0:${f}:*:0:*:*:*:0`, from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
  assert.deepEqual(tvCalls.filter(u => u.includes('modsearch')).map(u => new URL(u).searchParams.get('meal')), f === '5' ? ['9', '9'] : ['0', '0']);
}
// питание «Полный пансион и лучше»: в основном поиске FB (5), плюс отдельно UAI (9)
for (const k of [...kv.keys()]) if (k.startsWith('q3:')) kv.delete(k);
tvCalls.length = 0;
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:3:*:0:*:*:*:0', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
assert.deepEqual(tvCalls.filter(u => u.includes('modsearch')).map(u => new URL(u).searchParams.get('meal')), ['5', '5', '9', '9']);

// ---- статистика и пульт ----
const sdb = new DatabaseSync(':memory:');
sdb.exec(readFileSync('schema.sql', 'utf8'));
env.DB = { prepare: sql => { const st = sdb.prepare(sql); let b = []; const o = { bind: (...a) => { b = a; return o; }, run: async () => { st.run(...b); return {}; }, all: async () => ({ results: st.all(...b) }) }; return o; } };
env.PANEL_KEY = 'secret-key';
const today9 = astanaDay(new Date());
const panelGet = (path, key) => worker.fetch(new Request('https://x' + path, { headers: key ? { 'x-key': key } : {} }), env, ctx);

// события пишутся: «Старт», «Подобрать тур», готовая подборка; ссылки считаются
await post('/tg', { message: { chat: { id: 501 }, from: { id: 501 }, message_id: 1, text: '/start' } }, TG);
await post('/tg', { message: { chat: { id: 501 }, from: { id: 501 }, message_id: 2, text: '🔎 Подобрать тур за 1 минуту' } }, TG);
await post('/tg', { message: { chat: { id: 502 }, from: { id: 502 }, message_id: 1, text: '/start' } }, TG);
kv.set('m:7', '[]');
await post('/tg', { callback_query: { id: 'q', data: 'w:2:2:0::1:0:*:*:0:*:*:*:0', from: { id: 7 }, message: { chat: { id: 7 }, message_id: 1 } } }, TG);
const goRes = await panelGet('/go/bot/instagram');
assert.equal(goRes.status, 302);
assert.equal(goRes.headers.get('location'), 'https://t.me/HotToursAstana_bot');
assert.equal((await panelGet('/go/channel/whatsapp')).headers.get('location'), 'https://t.me/ch');

// пульт: страница открыта, данные только по ключу
const page = await panelGet('/panel');
assert.match(await page.text(), /Пульт · Горящие от ТурБота/);
assert.equal((await panelGet(`/panel/api?from=${today9}&to=${today9}`)).status, 401);
assert.equal((await panelGet(`/panel/api?from=${today9}&to=${today9}`, 'wrong')).status, 401);
const rep = await (await panelGet(`/panel/api?from=${today9}&to=${today9}`, 'secret-key')).json();
assert.equal(rep.users, 3); // 501, 502 и клиент проверки
assert.equal(rep.searches, 1);
assert.ok(rep.starts >= 2 && rep.presses >= 1);
assert.deepEqual(rep.topCountries[0], ['Таиланд', 1]);
assert.deepEqual(rep.topAirports[0], ['Астана', 1]);
assert.deepEqual(rep.links.sort(), [['bot:instagram', 1], ['channel:whatsapp', 1]]);
assert.equal(rep.subsNow, 123);
assert.equal(rep.newUsers, 3);
assert.equal(rep.cfg.access, 'auto');
// период в прошлом — пусто
const empty = await (await panelGet('/panel/api?from=2020-01-01&to=2020-01-02', 'secret-key')).json();
assert.equal(empty.users, 0);

// настройки из пульта
const setCfgReq = (path, value) => worker.fetch(new Request('https://x/panel/api/set', { method: 'POST', headers: { 'x-key': 'secret-key' }, body: JSON.stringify({ path, value }) }), env, ctx).then(r => r.json());
assert.equal((await setCfgReq('access', 'hack')).ok, false);
assert.equal((await setCfgReq('openUntil', 'завтра')).ok, false);
assert.equal((await worker.fetch(new Request('https://x/panel/api/set', { method: 'POST', body: '{}' }), env, ctx)).status, 401);
// доступ «только подписчикам» включается сразу, без даты
assert.equal((await setCfgReq('access', 'subs')).ok, true);
memberStatus = 'left';
sent.length = 0;
await post('/tg', { message: { chat: { id: 503 }, from: { id: 503 }, message_id: 1, text: '/start' } }, TG);
assert.match(sent.at(-1).text, /Далее бот доступен бесплатно только подписчикам/);
assert.equal((await (await panelGet(`/panel/api?from=${today9}&to=${today9}`, 'secret-key')).json()).locked, 1); // «не пустили» посчитано
assert.equal((await setCfgReq('access', 'open')).ok, true); // «открыт всем»
sent.length = 0;
await post('/tg', { message: { chat: { id: 503 }, from: { id: 503 }, message_id: 2, text: '/start' } }, TG);
assert.match(sent.find(m => m.method === 'sendMessage').text, /Здравствуйте/);
assert.equal((await setCfgReq('access', 'auto')).ok, true);
memberStatus = 'member';
// разделы концепции и посты выключаются
assert.equal((await setCfgReq('concept', false)).ok, true);
assert.equal((await setCfgReq('posts.news', false)).ok, true);
const runNews = await worker.fetch(new Request('https://x/run?job=news', { method: 'POST', headers: { 'x-secret': 's' } }), env, ctx);
assert.equal((await runNews.json()).skipped, 'выключено в пульте');
assert.equal((await setCfgReq('posts.news', true)).ok, true);
assert.equal((await setCfgReq('concept', true)).ok, true);
// журнал изменений: правки бота (из истории публикаций) и настройки из пульта попадают в пульт сами
const log = (await (await panelGet(`/panel/api?from=${today9}&to=${today9}`, 'secret-key')).json()).changes;
assert.ok(log.some(c => c.src === 'код' && c.text === 'Кнопка Назад на каждом шаге'));
assert.ok(log.some(c => c.src === 'пульт' && c.text === 'Настройка в пульте: posts.news = false'));
// два менеджера (бот LuxTour): по кнопке на город; без MANAGERS — одна CONTACT_URL
const mgr = managerRows({ MANAGERS: "Петропавловск=77751294061,Астана=77083098730" }, "📩 Написать менеджеру", "Привет");
assert.deepEqual(mgr.map(r => r[0].text), ["📩 Написать менеджеру · Петропавловск", "📩 Написать менеджеру · Астана"]);
assert.equal(mgr[1][0].url, "https://wa.me/77083098730?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
assert.equal(managerRows({ CONTACT_URL: "https://wa.me/1" }, "X", "y")[0][0].text, "X");

console.log('OK');
