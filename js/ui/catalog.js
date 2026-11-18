// "Customers & Projects" tab: customers with their projects, add/edit dialogs.

import { state } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, colorDot, icon, toast, errorText } from './dom.js';
import { addCustomer, updateCustomer, deleteCustomer, addProject, updateProject, deleteProject } from '../storage.js';
import { validateName, validateColor, validateTicketTemplate } from '../core/validate.js';
import { parseAmount, amountToInput, formatRate } from '../core/format.js';
import { effectiveRate } from '../core/export.js';

const $ = (id) => document.getElementById(id);

function statusPill(active) {
  return h('span', { class: `pill ${active ? 'pill-active' : 'pill-inactive'}` }, t(active ? 'status.active' : 'status.inactive'));
}

function iconButton(name, label, onclick, extra = '') {
  return h('button', { type: 'button', class: `btn btn-sm btn-ghost ${extra}`, title: label, 'aria-label': label, onclick }, icon(name));
}

export function renderCatalog() {
  const root = clear($('catalogList'));
  if (state.customers.length === 0) {
    root.append(h('p', { class: 'empty-note' }, t('catalog.empty')));
    return;
  }
  const customers = [...state.customers].sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));
  for (const c of customers) root.append(customerCard(c));
}

function customerCard(c) {
  const projects = state.projects.filter((p) => p.customerId === c.id)
    .sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));

  const header = h('div', { class: 'customer-head' },
    h('div', { class: 'customer-title' },
      colorDot(c.colorHex),
      h('h3', { class: 'customer-name' }, c.name),
      statusPill(c.isActive),
      c.defaultRate !== null ? h('span', { class: 'muted' }, `${t('catalog.defaultRate')}: ${formatRate(c.defaultRate)}`) : null),
    h('div', { class: 'customer-actions' },
      h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => openProjectDialog(null, c.id) }, t('catalog.addProject')),
      iconButton('edit', t('catalog.editCustomer'), () => openCustomerDialog(c)),
      h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: () => toggleCustomer(c) }, t(c.isActive ? 'catalog.deactivate' : 'catalog.activate')),
      iconButton('delete', t('catalog.deleteCustomer'), () => removeCustomer(c, projects.length), 'btn-del')));

  let body;
  if (projects.length === 0) {
    body = h('p', { class: 'empty-note' }, t('catalog.noProjects'));
  } else {
    body = h('div', { class: 'table-responsive' }, h('table', { class: 'data-table data-table-compact' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('col.project')),
        h('th', { scope: 'col' }, t('catalog.rate')),
        h('th', { scope: 'col' }, t('catalog.ticketLink')),
        h('th', { scope: 'col' }, t('catalog.status')),
        h('th', { scope: 'col', class: 'cell-actions' }, ''))),
      h('tbody', {}, projects.map((p) => projectRow(p, c)))));
  }
  return h('section', { class: `customer-card${c.isActive ? '' : ' is-inactive'}` }, header, body);
}

function projectRow(p, c) {
  const own = p.hourlyRate !== null;
  const rate = effectiveRate(p, c);
  const rateCell = rate === null ? h('span', { class: 'placeholder' }, '–')
    : h('span', {}, formatRate(rate), own ? '' : h('span', { class: 'muted' }, ` (${t('catalog.fromCustomer')})`));
  return h('tr', {},
    h('td', {}, h('strong', {}, p.name)),
    h('td', {}, rateCell),
    h('td', { class: 'cell-url' }, p.ticketUrlTemplate || h('span', { class: 'placeholder' }, '–')),
    h('td', {}, statusPill(p.isActive)),
    h('td', { class: 'cell-actions' },
      iconButton('edit', t('catalog.editProject'), () => openProjectDialog(p)),
      h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: () => toggleProject(p) }, t(p.isActive ? 'catalog.deactivate' : 'catalog.activate')),
      iconButton('delete', t('catalog.deleteProject'), () => removeProject(p), 'btn-del')));
}

async function toggleCustomer(c) { await updateCustomer(c.id, { isActive: !c.isActive }); }
async function toggleProject(p) { await updateProject(p.id, { isActive: !p.isActive }); }

async function removeCustomer(c, projectCount) {
  if (!confirm(t('catalog.confirmDeleteCustomer', { name: c.name, n: projectCount }))) return;
  try {
    await deleteCustomer(c.id);
  } catch (err) {
    toast(err.code === 'hasEntries' ? t('err.hasEntriesCustomer') : errorText('saveFailed'), 'error');
  }
}

async function removeProject(p) {
  if (!confirm(t('catalog.confirmDeleteProject', { name: p.name }))) return;
  try {
    await deleteProject(p.id);
  } catch (err) {
    toast(err.code === 'hasEntries' ? t('err.hasEntriesProject') : errorText('saveFailed'), 'error');
  }
}

// ---- Customer dialog ----

function openCustomerDialog(customer) {
  $('dlgCustomerId').value = customer ? customer.id : '';
  $('dlgCustomerTitle').textContent = t(customer ? 'catalog.editCustomer' : 'catalog.addCustomer');
  $('dlgCustomerName').value = customer ? customer.name : '';
  $('dlgCustomerColor').value = customer ? customer.colorHex : nextColor();
  $('dlgCustomerRate').value = customer ? amountToInput(customer.defaultRate) : '';
  $('dlgCustomer').showModal();
}

const PALETTE = ['#0078D4', '#107C10', '#8764B8', '#D83B01', '#008272', '#B4009E', '#986F0B', '#486991'];
function nextColor() {
  return PALETTE[state.customers.length % PALETTE.length];
}

async function saveCustomer() {
  const id = $('dlgCustomerId').value;
  const name = $('dlgCustomerName').value.trim();
  const colorHex = $('dlgCustomerColor').value;
  const rate = parseAmount($('dlgCustomerRate').value);
  const problem = validateName(name) || validateColor(colorHex) || (rate.valid ? null : 'invalidRate');
  if (problem) { toast(errorText(problem), 'error'); return; }
  if (id) await updateCustomer(Number(id), { name, colorHex, defaultRate: rate.value });
  else await addCustomer({ name, colorHex, defaultRate: rate.value });
  $('dlgCustomer').close();
}

// ---- Project dialog ----

function openProjectDialog(project, customerId = null) {
  const select = clear($('dlgProjectCustomer'));
  for (const c of state.customers) select.append(h('option', { value: c.id }, c.isActive ? c.name : `${c.name} (${t('status.inactive')})`));
  select.value = String(project ? project.customerId : customerId);
  $('dlgProjectId').value = project ? project.id : '';
  $('dlgProjectTitle').textContent = t(project ? 'catalog.editProject' : 'catalog.addProject');
  $('dlgProjectName').value = project ? project.name : '';
  $('dlgProjectRate').value = project ? amountToInput(project.hourlyRate) : '';
  $('dlgProjectTemplate').value = project && project.ticketUrlTemplate ? project.ticketUrlTemplate : '';
  $('dlgProject').showModal();
}

async function saveProject() {
  const id = $('dlgProjectId').value;
  const customerId = Number($('dlgProjectCustomer').value);
  const name = $('dlgProjectName').value.trim();
  const rate = parseAmount($('dlgProjectRate').value);
  const template = $('dlgProjectTemplate').value.trim();
  const problem = validateName(name) || (rate.valid ? null : 'invalidRate') || validateTicketTemplate(template)
    || (customerId ? null : 'nameRequired');
  if (problem) { toast(errorText(problem), 'error'); return; }
  const data = { customerId, name, hourlyRate: rate.value, ticketUrlTemplate: template || null };
  if (id) await updateProject(Number(id), data);
  else await addProject(data);
  $('dlgProject').close();
}

export function initCatalog() {
  $('btnAddCustomer').addEventListener('click', () => openCustomerDialog(null));
  $('formCustomer').addEventListener('submit', (e) => { e.preventDefault(); saveCustomer().catch((err) => { console.error(err); toast(errorText('saveFailed'), 'error'); }); });
  $('formProject').addEventListener('submit', (e) => { e.preventDefault(); saveProject().catch((err) => { console.error(err); toast(errorText('saveFailed'), 'error'); }); });
  for (const id of ['btnDlgCustomerCancel', 'btnDlgCustomerClose']) $(id).addEventListener('click', () => $('dlgCustomer').close());
  for (const id of ['btnDlgProjectCancel', 'btnDlgProjectClose']) $(id).addEventListener('click', () => $('dlgProject').close());
}
