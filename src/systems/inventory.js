const MAGAZINE_SIZE = 15;

export function createInventory({ element, onToggle = () => {}, onReload = () => {} }) {
  let open = false;
  let selected = 'handgun';
  let magazine = MAGAZINE_SIZE;
  let reserve = 15;

  const items = [
    { id: 'handgun', name: 'Pistola 9 mm', icon: '/ui/handgun.png', quantity: () => '1', description: 'Pistola de serviço da R.P.D. Equipada.' },
    { id: 'ammo', name: 'Munição de pistola', icon: '/ui/ammo.png', quantity: () => String(reserve), description: 'Cartuchos de 9 mm para a pistola.' },
    { id: 'knife', name: 'Faca de combate', icon: '/ui/knife.png', quantity: () => '1', description: 'Faca de combate. Útil quando não há munição.' },
  ];

  function reload() {
    if (!reserve || magazine >= MAGAZINE_SIZE) return 0;
    const loaded = Math.min(MAGAZINE_SIZE - magazine, reserve);
    magazine += loaded;
    reserve -= loaded;
    render();
    onReload();
    return loaded;
  }

  function select(id) {
    if (!items.some((item) => item.id === id)) return;
    selected = id;
    render();
  }

  function render() {
    const current = items.find((item) => item.id === selected) || items[0];
    element.innerHTML = `
      <section class="inventory-window" aria-label="Inventário">
        <header class="inventory-header"><span>R.P.D. <b>ITEM BOX</b></span><span>R.P.D. TACTICAL</span></header>
        <div class="inventory-content">
          <section class="inventory-left">
            <div class="inventory-label">INVENTÁRIO <small>03 / 12</small></div>
            <div class="inventory-grid" role="listbox" aria-label="Itens">
              ${items.map((item) => `<button class="inventory-slot ${item.id === selected ? 'selected' : ''}" data-item="${item.id}" aria-label="${item.name}, quantidade ${item.quantity()}" aria-selected="${item.id === selected}">
                <img src="${item.icon}" alt=""><span class="slot-count">${item.quantity()}</span>
              </button>`).join('')}
              ${Array.from({ length: 9 }, () => '<div class="inventory-slot empty" aria-hidden="true"></div>').join('')}
            </div>
            <div class="inventory-hint">I / TAB  FECHAR <span>R  RECARREGAR</span></div>
          </section>
          <aside class="inventory-right">
            <div class="inventory-portrait"><span>LEON</span><b>S. KENNEDY</b></div>
            <div class="inventory-status"><span>STATUS</span><strong>FINE</strong><i><b></b><b></b><b></b><b></b><b></b></i></div>
            <div class="selected-item"><span>ITEM SELECIONADO</span><h2>${current.name}</h2><p>${current.description}</p></div>
            <div class="ammo-readout"><span>CARREGADOR</span><strong>${magazine} <small>/ ${MAGAZINE_SIZE}</small></strong><span>RESERVA</span><strong>${reserve}</strong></div>
            <button class="inventory-action" ${selected !== 'ammo' || magazine >= MAGAZINE_SIZE || reserve <= 0 ? 'disabled' : ''}>${selected === 'ammo' ? 'RECARREGAR' : 'EQUIPADA'}</button>
          </aside>
        </div>
        <footer class="inventory-footer"><span>RACCOON POLICE DEPARTMENT</span><span>1998</span></footer>
      </section>`;
    element.querySelectorAll('[data-item]').forEach((button) => button.addEventListener('click', () => select(button.dataset.item)));
    element.querySelector('.inventory-action').addEventListener('click', () => {
      if (selected === 'ammo') reload();
    });
  }

  function setOpen(value) {
    if (open === value) return;
    open = value;
    if (open) render();
    element.classList.toggle('open', open);
    element.setAttribute('aria-hidden', String(!open));
    onToggle(open);
  }

  return {
    get isOpen() { return open; },
    get ammo() { return { magazine, reserve, capacity: MAGAZINE_SIZE }; },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    addAmmo(amount = 15) { reserve += Math.max(0, amount | 0); if (open) render(); },
    consumeRound() { if (magazine <= 0) return false; magazine--; if (open) render(); return true; },
    reload,
  };
}
