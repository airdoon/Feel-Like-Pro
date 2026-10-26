const state = { user: null, csrf: '', config: null, editTournament: null, editNews: null };
const app = document.getElementById('app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = value => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const localDate = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const statusName = { draft: 'Черновик', published: 'Опубликовано', open: 'Регистрация открыта', closed: 'Регистрация закрыта', live: 'Идёт турнир', completed: 'Завершён', pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена', withdrawn: 'Отозвана', ready: 'Готов', upper: 'Верхняя сетка', lower: 'Нижняя сетка', final: 'Финал' };
const page = (title, subtitle, content, kicker = 'FEEL LIKE PRO') => `<section class="page"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="muted">${subtitle}</p>${content}</section>`;
const empty = text => `<div class="empty">${esc(text)}</div>`;
const options = (values, selected) => values.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const input = (name, label, value = '', type = 'text', extra = '') => `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const area = (name, label, value = '', extra = '') => `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" ${extra}>${esc(value)}</textarea></div>`;
const select = (name, label, values, selected) => `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options(values, selected)}</select></div>`;
const image = (url, fallback) => url ? `<img class="avatar" src="${esc(url)}" alt="">` : `<div class="avatar">${esc((fallback || '?').slice(0, 1).toUpperCase())}</div>`;
async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(!['GET', 'HEAD'].includes(method) ? { 'x-csrf-token': state.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
let toastTimer;
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4400); }
function routeParts() { return decodeURIComponent(location.hash.slice(1) || 'home').split('/'); }
function navigate(hash) { if (location.hash === `#${hash}`) render(); else location.hash = hash; }
async function refreshMe() {
  const data = await api('/api/me'); state.user = data.user; state.csrf = data.csrf;
  const button = document.getElementById('loginButton');
  button.textContent = state.user ? (state.user.nickname || state.user.display_name) : 'Войти';
  button.dataset.action = state.user ? 'profile' : 'login';
  const nav = document.getElementById('nav');
  nav.querySelector('#adminLink')?.remove();
  if (state.user?.role === 'admin') nav.insertAdjacentHTML('beforeend', '<a id="adminLink" href="#admin">Админ</a>');
}
function openLogin() { document.getElementById('loginModal').classList.add('open'); }
function closeLogin() { document.getElementById('loginModal').classList.remove('open'); }
window.onTelegramAuth = async user => {
  try {
    const result = await api('/auth/telegram', 'POST', user);
    state.user = result.user; state.csrf = result.csrf; closeLogin();
    await refreshMe(); toast('Вы вошли через Telegram.'); render();
  } catch (error) { toast(error.message); }
};
async function loadWidget() {
  state.config = await api('/api/config');
  if (!state.config.telegramBotUsername) { document.getElementById('telegramWidget').textContent = 'Вход пока не настроен администратором.'; return; }
  const script = document.createElement('script'); script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login', state.config.telegramBotUsername);
  script.setAttribute('data-size', 'large'); script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-onauth', 'onTelegramAuth(user)');
  document.getElementById('telegramWidget').appendChild(script);
}
const tournamentCard = t => `<article class="card"><div class="row"><span class="pill">${esc(statusName[t.status] || t.status)}</span><span class="tiny">${fmt(t.starts_at)}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.game)} · ${t.participant_type === 'team' ? `${t.team_size}×${t.team_size}` : 'Соло'} · ${t.format === 'double' ? 'Double' : 'Single'} Elimination</p><p>${esc(t.description).slice(0, 140)}</p><div class="row"><span class="gold">${esc(t.prizes || 'Призы уточняются')}</span><a class="btn small" href="#tournament/${esc(t.id)}">Подробнее →</a></div></article>`;
const newsCard = n => `<article class="card"><span class="tiny">${fmt(n.published_at || n.created_at)}</span><h3>${esc(n.title)}</h3><p>${esc(n.summary || n.body.slice(0, 180))}</p><a class="btn alt small" href="#article/${esc(n.slug)}">Читать →</a></article>`;
async function home() {
  const [tournaments, news, hall] = await Promise.all([api('/api/tournaments'), api('/api/news'), api('/api/hall')]);
  return `<section class="hero"><div><div class="eyebrow">COMPETE · CONNECT · WIN</div><h1>FEEL LIKE<br><span>PRO.</span></h1><p>Турниры, команды и игроки в одном месте. Собери состав, подай заявку и оставь имя в истории сообщества.</p><div class="actions"><a class="btn" href="#tournaments">Выбрать турнир →</a><a class="btn alt" href="#players">Найти игроков</a></div></div><div class="hero-art"><div class="crystal"></div></div></section><section class="section-head"><h2>Ближайшие турниры</h2><a class="btn alt small" href="#tournaments">Все турниры</a></section><div class="grid">${tournaments.slice(0, 3).map(tournamentCard).join('') || empty('Турниры появятся здесь после публикации.')}</div><section class="section-head"><h2>Новости</h2><a class="btn alt small" href="#news">Все новости</a></section><div class="grid">${news.slice(0, 3).map(newsCard).join('') || empty('Публикации пока не добавлены.')}</div><section class="section-head"><h2>Зал славы</h2><a class="btn alt small" href="#hall">Вся история</a></section>${hall.find(r => r.place === 1) ? `<div class="panel"><span class="gold">Последний чемпион</span><h2>${esc(hall.find(r => r.place === 1).name_snapshot)}</h2><p class="muted">${esc(hall.find(r => r.place === 1).title)}</p></div>` : empty('Первые чемпионы появятся после завершения турнира.')}`;
}
async function news() { const rows = await api('/api/news'); return page('Новости.', 'Публикации, обновления платформы и жизнь сообщества.', `<div class="grid">${rows.map(newsCard).join('') || empty('Новостей пока нет.')}</div>`, 'BLOG · UPDATES'); }
async function article(slug) { const n = await api(`/api/news/${encodeURIComponent(slug)}`); return page(esc(n.title), fmt(n.published_at || n.created_at), `<div class="article">${esc(n.body)}</div><div class="actions"><a class="btn alt" href="#news">← Все новости</a></div>`, 'NEWS'); }
async function tournaments() { const rows = await api('/api/tournaments'); return page('Турниры.', 'Выбирай соревнование и следи за турнирной сеткой.', `<div class="grid">${rows.map(tournamentCard).join('') || empty('Открытых турниров пока нет.')}</div>`, 'TOURNAMENTS'); }
function bracket(matches, isAdmin) {
  if (!matches.length) return empty('Сетка появится после подтверждения участников и запуска турнира.');
  const groups = new Map();
  for (const m of matches) { const key = `${m.bracket}:${m.round_no}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(m); }
  return `<div class="bracket">${[...groups].map(([key, games]) => `<div class="bracket-col"><h3>${esc(statusName[key.split(':')[0]])} · ${key.split(':')[1]}</h3>${games.map(m => `<div class="match"><span class="tiny">Матч ${m.position} · ${esc(statusName[m.status] || m.status)}</span><p><span>${esc(m.name_a || 'Ожидается')}</span><strong>${m.score_a ?? '—'}</strong></p><p><span>${esc(m.name_b || 'Ожидается')}</span><strong>${m.score_b ?? '—'}</strong></p>${isAdmin && m.status === 'ready' ? `<form data-form="result" data-id="${esc(m.id)}" class="actions"><input aria-label="Счёт первой стороны" name="score_a" type="number" min="0" max="100" required style="width:60px"><input aria-label="Счёт второй стороны" name="score_b" type="number" min="0" max="100" required style="width:60px"><button class="btn small">Сохранить</button></form>` : ''}</div>`).join('')}</div>`).join('')}</div>`;
}
async function tournament(id) {
  const t = await api(`/api/tournaments/${encodeURIComponent(id)}`);
  const isAdmin = state.user?.role === 'admin';
  let registration = '';
  if (t.status === 'open') {
    if (!state.user) registration = '<button class="btn" data-action="login">Войти для регистрации</button>';
    else if (t.participant_type === 'solo') registration = `<button class="btn" data-action="register-solo" data-id="${esc(t.id)}">Подать заявку</button>`;
    else {
      const teams = await api('/api/teams');
      const captained = teams.filter(team => team.captain_id === state.user.id);
      registration = `<form data-form="register-team" data-id="${esc(t.id)}" class="actions"><select class="btn alt" name="team_id" required><option value="">Выберите свою команду</option>${captained.map(team => `<option value="${esc(team.id)}">${esc(team.name)} (${team.member_count} игроков)</option>`).join('')}</select><button class="btn">Подать заявку</button><a class="btn alt" href="#teams">Мои команды</a></form>`;
    }
  }
  const entries = t.entries.filter(e => e.status === 'approved');
  return page(esc(t.title), `${esc(t.game)} · ${fmt(t.starts_at)} · ${esc(statusName[t.status] || t.status)}`, `<div class="grid two"><div class="panel"><h2>О турнире</h2><p class="muted article">${esc(t.description || 'Описание будет опубликовано организатором.')}</p><div class="row"><span>Формат</span><strong>${t.format === 'double' ? 'Double Elimination' : 'Single Elimination'}</strong></div><hr class="separator"><div class="row"><span>Участники</span><strong>${t.participant_type === 'team' ? `Команды по ${t.team_size}` : 'Соло'} · ${t.approved_count}/${t.max_entries}</strong></div><hr class="separator"><div class="row"><span>Регистрация до</span><strong>${fmt(t.registration_close_at)}</strong></div></div><div class="panel"><h2>Призы</h2><p class="gold article">${esc(t.prizes || 'Уточняются')}</p><h3>Правила</h3><p class="muted article">${esc(t.rules || 'Правила скоро появятся.')}</p></div></div><div class="actions">${registration}</div><section class="section-head"><h2>Участники</h2><span class="badge">${entries.length} одобрено</span></section><div class="grid">${entries.map(e => `<div class="card"><div class="teamline">${image(e.logo_url, e.name)}<strong>${esc(e.name)}</strong></div><p>${esc((e.roster || []).join(', '))}</p></div>`).join('') || empty('Пока нет одобренных участников.')}</div><section class="section-head"><h2>Турнирная сетка</h2></section>${bracket(t.matches, isAdmin)}${isAdmin && ['open', 'closed'].includes(t.status) && !t.matches.length ? `<div class="notice">Для запуска сетки необходимо 2, 4, 8, 16 или 32 одобренных участника. Порядок заявок определяет посев.</div><div class="actions"><button class="btn" data-action="start-bracket" data-id="${esc(t.id)}">Запустить сетку</button></div>` : ''}${isAdmin && t.status === 'live' ? `<div class="actions"><button class="btn" data-action="finish" data-id="${esc(t.id)}">Опубликовать результаты</button></div>` : ''}`, 'TOURNAMENT');
}
async function hall() {
  const rows = await api('/api/hall');
  return page('Зал славы.', 'История чемпионов и составов на момент победы.', `<div class="grid">${rows.map(r => `<article class="card"><span class="gold">${r.place === 1 ? '🥇 Чемпион' : r.place === 2 ? '🥈 Финалист' : '🥉 Третье место'}</span><h3>${esc(r.name_snapshot)}</h3><p>${esc(r.title)} · ${fmt(r.ends_at)}</p><div class="teamline">${image(r.logo_url_snapshot, r.name_snapshot)}<span>${esc((r.roster_snapshot || []).join(', '))}</span></div><div class="actions"><a class="btn alt small" href="#tournament/${esc(r.tournament_id)}">Турнир →</a></div></article>`).join('') || empty('Первые победители появятся после завершения турнира.')}</div>`, 'LEGENDS');
}
async function players() {
  const [rows, own] = await Promise.all([api('/api/free-players'), state.user ? api('/api/free-players/me') : Promise.resolve(null)]);
  const form = state.user ? `<div class="panel"><h2>Моя заявка</h2><form data-form="free-player"><div class="form-grid">${input('mmr', 'MMR / рейтинг', own?.mmr ?? '', 'number', 'min="0" max="20000" required')}${input('position', 'Позиция / роль', own?.position || '', 'text', 'required')}${input('heroes', 'Основные герои через запятую', (own?.heroes || []).join(', '))}${input('game', 'Игра', own?.game || 'Dota 2')}</div>${area('description', 'О себе', own?.description || '')}<label class="check"><input type="checkbox" name="contact_consent" ${own?.contact_consent ? 'checked' : ''}> Согласен показать мой Telegram username в публичной заявке</label><label class="check"><input type="checkbox" name="is_visible" ${own?.is_visible ? 'checked' : ''}> Показывать заявку в списке</label><button class="btn">Сохранить заявку</button></form>${!state.user.telegram_username ? '<p class="notice">У вашего аккаунта нет Telegram username. Установите его в Telegram и войдите повторно, чтобы опубликовать контакт.</p>' : ''}</div>` : '<div class="notice">Чтобы добавить себя в список, войдите через Telegram.</div>';
  return page('Свободные игроки.', 'Найди состав или познакомься с игроками напрямую в Telegram.', `${form}<section class="section-head"><h2>Игроки в поиске</h2></section><div class="field"><label for="playerSearch">Поиск по нику, роли или герою</label><input id="playerSearch" placeholder="Например, саппорт"></div><div class="grid" id="playerGrid">${rows.map(p => `<article class="card player-card"><div class="teamline">${image(p.avatar_url, p.name)}<div><h3>${esc(p.name)}</h3><span class="tiny">${esc(p.game)} · MMR ${p.mmr} · ${esc(p.position)}</span></div></div><p>Герои: ${esc((p.heroes || []).join(', ') || 'Не указаны')}</p><p>${esc(p.description)}</p><a class="btn alt small" href="https://t.me/${encodeURIComponent(p.telegram_username)}" target="_blank" rel="noopener noreferrer">Написать в Telegram →</a></article>`).join('') || empty('Пока никто не опубликовал заявку.')}</div>`, 'FIND YOUR TEAM');
}
async function teams() {
  if (!state.user) return page('Команды.', 'Капитан регистрирует команду на турнир.', `<div class="notice">Войдите через Telegram, чтобы создавать команды и вступать в них.</div><button class="btn" data-action="login">Войти</button>`, 'SQUADS');
  const rows = await api('/api/teams');
  return page('Команды.', 'Создайте состав или присоединитесь по коду капитана.', `<div class="grid two"><div class="panel"><h2>Создать команду</h2><form data-form="team-create">${input('name', 'Название', '', 'text', 'required minlength="2" maxlength="80"')}${input('logo_url', 'HTTPS-ссылка на логотип (необязательно)', '', 'url')}<button class="btn">Создать</button></form></div><div class="panel"><h2>Присоединиться</h2><p class="muted">Попросите у капитана код приглашения.</p><form data-form="team-join">${input('code', 'Код приглашения', '', 'text', 'required')}<button class="btn">Вступить</button></form></div></div><section class="section-head"><h2>Мои команды</h2></section><div class="grid">${rows.map(t => `<div class="card"><div class="teamline">${image(t.logo_url, t.name)}<strong>${esc(t.name)}</strong></div><p>${t.member_count} игроков · ${t.captain_id === state.user.id ? 'Вы капитан' : 'Вы участник'}</p><a class="btn alt small" href="#team/${esc(t.id)}">Открыть →</a></div>`).join('') || empty('У вас пока нет команды.')}</div>`, 'SQUADS');
}
async function team(id) {
  const t = await api(`/api/teams/${encodeURIComponent(id)}`);
  const mine = state.user?.id === t.captain_id;
  const myTeams = state.user ? await api('/api/teams') : [];
  const myTeam = myTeams.find(x => x.id === t.id);
  return page(esc(t.name), `${t.members.length} игроков`, `<div class="grid two"><div class="panel"><h2>Состав</h2><div class="stack">${t.members.map(m => `<div class="row"><span>${esc(m.name)} ${m.id === t.captain_id ? '· капитан' : ''}</span>${(mine && m.id !== t.captain_id) || (state.user?.id === m.id && m.id !== t.captain_id) ? `<button class="btn danger small" data-action="remove-member" data-team="${esc(t.id)}" data-user="${esc(m.id)}">Удалить</button>` : ''}</div>`).join('')}</div></div>${mine ? `<div class="panel"><h2>Управление</h2><form data-form="team-edit" data-id="${esc(t.id)}">${input('name', 'Название', t.name, 'text', 'required')}${input('logo_url', 'Логотип HTTPS', t.logo_url || '', 'url')}<button class="btn">Сохранить</button></form><hr class="separator"><p class="muted">Код приглашения: <code>${esc(myTeam?.invite_code || '')}</code></p><button class="btn alt small" data-action="rotate-code" data-id="${esc(t.id)}">Сменить код</button></div>` : `<div class="panel"><h2>Команда</h2><p class="muted">${myTeam ? 'Вы состоите в этой команде.' : 'Состав команды доступен всем.'}</p></div>`}</div><div class="actions"><a class="btn alt" href="#teams">← Мои команды</a></div>`, 'SQUAD');
}
async function profile() {
  if (!state.user) return page('Личный кабинет.', 'Управляйте участием в турнирах.', `<div class="notice">Для доступа к профилю войдите через Telegram.</div><button class="btn" data-action="login">Войти</button>`, 'PROFILE');
  const entries = await api('/api/my-entries');
  return page('Личный кабинет.', 'Профиль игрока и заявки на турниры.', `<div class="grid two"><div class="panel"><div class="teamline">${image(state.user.avatar_url, state.user.display_name)}<div><h2>${esc(state.user.nickname || state.user.display_name)}</h2><span class="small">@${esc(state.user.telegram_username || 'username не установлен')} · ${esc(state.user.role)}</span></div></div><hr class="separator"><form data-form="profile">${input('nickname', 'Игровой ник', state.user.nickname || '', 'text', 'required maxlength="40"')}<button class="btn">Сохранить ник</button></form><div class="actions"><button class="btn alt" data-action="logout">Выйти</button></div></div><div class="panel"><h2>Мои заявки</h2>${entries.map(e => `<div class="row" style="padding:10px 0;border-bottom:1px solid #ffffff16"><div><a href="#tournament/${esc(e.tournament_id)}">${esc(e.title)}</a><div class="tiny">${esc(e.team_name || 'Соло')} · ${esc(statusName[e.status])}</div>${e.review_note ? `<p class="tiny">${esc(e.review_note)}</p>` : ''}</div>${['pending', 'approved'].includes(e.status) ? `<button class="btn alt small" data-action="withdraw" data-id="${esc(e.id)}">Отозвать</button>` : ''}</div>`).join('') || empty('Заявок пока нет.')}</div></div>`, 'PROFILE');
}
function tournamentForm(t = {}) {
  return `<form data-form="tournament-save" data-id="${esc(t.id || '')}"><div class="form-grid">${input('title', 'Название', t.title || '', 'text', 'required')}${input('game', 'Игра', t.game || 'Dota 2')}${select('format', 'Формат', [['single', 'Single Elimination'], ['double', 'Double Elimination']], t.format || 'single')}${select('participant_type', 'Участники', [['team', 'Команды'], ['solo', 'Соло']], t.participant_type || 'team')}${input('team_size', 'Игроков в команде', t.team_size ?? 5, 'number', 'min="1" max="20" required')}${input('max_entries', 'Лимит участников', t.max_entries ?? 16, 'number', 'min="2" max="32" required')}${select('status', 'Статус', [['draft', 'Черновик'], ['open', 'Регистрация'], ['closed', 'Регистрация закрыта'], ...(t.status === 'live' ? [['live', 'Идёт турнир']] : [])], t.status || 'draft')}${input('starts_at', 'Начало турнира', localDate(t.starts_at), 'datetime-local', 'required')}${input('registration_open_at', 'Начало регистрации', localDate(t.registration_open_at), 'datetime-local')}${input('registration_close_at', 'Конец регистрации', localDate(t.registration_close_at), 'datetime-local')}</div>${area('description', 'Описание', t.description || '')}${area('rules', 'Правила', t.rules || '')}${area('prizes', 'Призы', t.prizes || '')}<div class="actions"><button class="btn">${t.id ? 'Сохранить турнир' : 'Создать турнир'}</button>${t.id ? '<button type="button" class="btn alt" data-action="clear-tournament">Новый турнир</button>' : ''}</div></form>`;
}
function newsForm(n = {}) { return `<form data-form="news-save" data-id="${esc(n.id || '')}">${input('title', 'Заголовок', n.title || '', 'text', 'required')}${input('summary', 'Краткое описание', n.summary || '')}${input('cover_url', 'HTTPS-ссылка на обложку', n.cover_url || '', 'url')}${area('body', 'Текст публикации', n.body || '', 'required')}${select('status', 'Статус', [['draft', 'Черновик'], ['published', 'Опубликовано']], n.status || 'draft')}<div class="actions"><button class="btn">${n.id ? 'Сохранить новость' : 'Создать новость'}</button>${n.id ? '<button type="button" class="btn alt" data-action="clear-news">Новая публикация</button>' : ''}</div></form>`; }
async function admin() {
  if (state.user?.role !== 'admin') return page('Доступ запрещён.', 'Этот раздел доступен администратору.', '', 'ADMIN');
  const [tours, posts] = await Promise.all([api('/api/tournaments?all=1'), api('/api/news?all=1')]);
  const selected = tours.find(t => t.id === state.editTournament) || {};
  const selectedNews = posts.find(n => n.id === state.editNews) || {};
  const pending = await Promise.all(tours.map(async t => ({ tournament: t, entries: (await api(`/api/tournaments/${t.id}`)).entries.filter(e => e.status === 'pending') })));
  return page('Админ-панель.', 'Турниры, заявки, матчи и публикации.', `<div class="panel"><h2>${selected.id ? 'Редактировать турнир' : 'Новый турнир'}</h2>${tournamentForm(selected)}</div><section class="section-head"><h2>Турниры</h2></section><div class="table-wrap"><table class="table"><thead><tr><th>Название</th><th>Статус</th><th>Одобрено</th><th>Действия</th></tr></thead><tbody>${tours.map(t => `<tr><td><a href="#tournament/${esc(t.id)}">${esc(t.title)}</a></td><td>${esc(statusName[t.status])}</td><td>${t.approved_count}/${t.max_entries}</td><td><button class="btn alt small" data-action="edit-tournament" data-id="${esc(t.id)}">Редактировать</button> ${!['live', 'completed'].includes(t.status) ? `<button class="btn danger small" data-action="delete-tournament" data-id="${esc(t.id)}">Удалить</button>` : ''}</td></tr>`).join('')}</tbody></table></div><section class="section-head"><h2>Заявки на рассмотрении</h2></section><div class="table-wrap"><table class="table"><thead><tr><th>Турнир</th><th>Участник</th><th>Действия</th></tr></thead><tbody>${pending.flatMap(({ tournament, entries }) => entries.map(e => `<tr><td>${esc(tournament.title)}</td><td>${esc(e.name)}</td><td><button class="btn small" data-action="review" data-id="${esc(e.id)}" data-status="approved">Одобрить</button> <button class="btn danger small" data-action="review" data-id="${esc(e.id)}" data-status="rejected">Отклонить</button></td></tr>`)).join('') || '<tr><td colspan="3">Новых заявок нет.</td></tr>'}</tbody></table></div><hr class="separator"><div class="panel"><h2>${selectedNews.id ? 'Редактировать новость' : 'Новая публикация'}</h2>${newsForm(selectedNews)}</div><section class="section-head"><h2>Публикации</h2></section><div class="table-wrap"><table class="table"><tbody>${posts.map(n => `<tr><td>${esc(n.title)}</td><td>${esc(statusName[n.status] || n.status)}</td><td><button class="btn alt small" data-action="edit-news" data-id="${esc(n.id)}">Редактировать</button> <button class="btn danger small" data-action="delete-news" data-id="${esc(n.id)}">Удалить</button></td></tr>`).join('')}</tbody></table></div>`, 'CONTROL ROOM');
}
async function render() {
  const [section, id] = routeParts();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.hash.slice(1) === section));
  app.innerHTML = '<section class="page"><p class="muted">Загрузка…</p></section>';
  try {
    const html = section === 'home' ? await home() : section === 'news' ? await news() : section === 'article' ? await article(id) : section === 'tournaments' ? await tournaments() : section === 'tournament' ? await tournament(id) : section === 'hall' ? await hall() : section === 'players' ? await players() : section === 'teams' ? await teams() : section === 'team' ? await team(id) : section === 'profile' ? await profile() : section === 'admin' ? await admin() : page('Страница не найдена.', '', '<a class="btn" href="#home">На главную</a>');
    app.innerHTML = html;
  } catch (error) { app.innerHTML = page('Не удалось загрузить страницу.', esc(error.message), '<button class="btn" data-action="retry">Повторить</button>'); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'login') return openLogin();
    if (action === 'close-login') return closeLogin();
    if (action === 'profile') return navigate('profile');
    if (action === 'retry') return render();
    if (action === 'clear-tournament') { state.editTournament = null; return render(); }
    if (action === 'clear-news') { state.editNews = null; return render(); }
    if (action === 'edit-tournament') { state.editTournament = id; return render(); }
    if (action === 'edit-news') { state.editNews = id; return render(); }
    if (action === 'logout') { await api('/auth/logout', 'POST'); await refreshMe(); toast('Вы вышли из аккаунта.'); return navigate('home'); }
    if (action === 'register-solo') { await api(`/api/tournaments/${id}/entries`, 'POST', {}); toast('Заявка отправлена на рассмотрение.'); return render(); }
    if (action === 'start-bracket') { if (!confirm('Запустить сетку с текущим составом? Посев будет по порядку заявок.')) return; await api(`/api/tournaments/${id}/bracket`, 'POST', {}); toast('Сетка запущена.'); return render(); }
    if (action === 'finish') { if (!confirm('Опубликовать результаты турнира?')) return; await api(`/api/tournaments/${id}/finish`, 'POST', {}); toast('Результаты опубликованы.'); return render(); }
    if (action === 'withdraw') { if (!confirm('Отозвать заявку?')) return; await api(`/api/entries/${id}/withdraw`, 'POST', {}); toast('Заявка отозвана.'); return render(); }
    if (action === 'review') { const note = button.dataset.status === 'rejected' ? prompt('Причина отклонения (необязательно):') : ''; if (note === null) return; await api(`/api/entries/${id}/review`, 'POST', { status: button.dataset.status, note }); toast('Решение сохранено.'); return render(); }
    if (action === 'delete-tournament') { if (!confirm('Удалить турнир и все его заявки? Это действие необратимо.')) return; await api(`/api/tournaments/${id}`, 'DELETE'); toast('Турнир удалён.'); return render(); }
    if (action === 'delete-news') { if (!confirm('Удалить публикацию?')) return; await api(`/api/news/${id}`, 'DELETE'); toast('Публикация удалена.'); return render(); }
    if (action === 'rotate-code') { if (!confirm('Старый код приглашения перестанет работать. Продолжить?')) return; await api(`/api/teams/${id}/rotate-code`, 'POST', {}); toast('Код приглашения изменён.'); return render(); }
    if (action === 'remove-member') { if (!confirm('Удалить участника из команды?')) return; await api(`/api/teams/${button.dataset.team}/members/${button.dataset.user}`, 'DELETE'); toast('Состав обновлён.'); return render(); }
  } catch (error) { toast(error.message); }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form, id = form.dataset.id;
  const submit = form.querySelector('button[type="submit"],button:not([type])'); if (submit) submit.disabled = true;
  try {
    if (type === 'profile') { state.user = await api('/api/me', 'PATCH', { nickname: data.nickname }); await refreshMe(); }
    else if (type === 'free-player') await api('/api/free-players/me', 'PUT', { game: data.game, mmr: Number(data.mmr), position: data.position, heroes: data.heroes.split(',').map(x => x.trim()).filter(Boolean), description: data.description, contact_consent: !!data.contact_consent, is_visible: !!data.is_visible });
    else if (type === 'team-create') await api('/api/teams', 'POST', data);
    else if (type === 'team-join') await api('/api/teams/join', 'POST', data);
    else if (type === 'team-edit') await api(`/api/teams/${id}`, 'PATCH', data);
    else if (type === 'register-team') await api(`/api/tournaments/${id}/entries`, 'POST', data);
    else if (type === 'result') await api(`/api/matches/${id}/result`, 'POST', { score_a: Number(data.score_a), score_b: Number(data.score_b) });
    else if (type === 'tournament-save') {
      const body = { ...data, team_size: Number(data.team_size), max_entries: Number(data.max_entries), registration_open_at: data.registration_open_at || null, registration_close_at: data.registration_close_at || null, starts_at: new Date(data.starts_at).toISOString() };
      const result = await api(id ? `/api/tournaments/${id}` : '/api/tournaments', id ? 'PATCH' : 'POST', body);
      state.editTournament = result.id;
    } else if (type === 'news-save') { const result = await api(id ? `/api/news/${id}` : '/api/news', id ? 'PATCH' : 'POST', data); state.editNews = result.id; }
    toast('Изменения сохранены.'); render();
  } catch (error) { toast(error.message); if (submit) submit.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'playerSearch') return;
  const q = event.target.value.toLocaleLowerCase('ru');
  document.querySelectorAll('.player-card').forEach(card => card.style.display = card.textContent.toLocaleLowerCase('ru').includes(q) ? '' : 'none');
});
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
Promise.all([refreshMe(), loadWidget()]).then(render).catch(error => { app.innerHTML = page('Сервис недоступен.', esc(error.message), '<button class="btn" data-action="retry">Повторить</button>'); });
