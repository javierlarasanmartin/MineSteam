import appState from '../state/appState.js';

export function setupNavigation({
    getCurrentView,
    setCurrentView,
    displayInstances,
    loadProfilesPage,
    loadServersPage,
    loadToolInstances,
    loadJavaManager,
    loadContentInstances,
    loadContent,
    updateCacheSize,
    searchModpacks
}) {
    const links = document.querySelectorAll('.nav a[data-target]');
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.dataset.target;
            if (!targetId) return;
            links.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active-page'));
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active-page');
            setCurrentView(targetId);
            appState.navigation.currentView = targetId;
            if (targetId === 'page-mods') {
                const input = document.getElementById('search-input');
                if (input && !input.value) {
                    input.value = '';
                    searchModpacks();
                }
            }
            if (targetId === 'page-instancias') displayInstances();
            if (targetId === 'page-perfiles') loadProfilesPage();
            if (targetId === 'page-servidores') loadServersPage();
            if (targetId === 'page-perfil') updateCacheSize();
            if (targetId === 'page-herramientas') { loadToolInstances(); loadJavaManager(); }
            if (targetId === 'page-contenido') { loadContentInstances(); loadContent(); }
            if (window.innerWidth <= 992) document.getElementById('sidebar')?.classList.remove('open');
        });
    });
    document.getElementById('btn-ver-todas-actividad')?.addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('[data-target="page-instancias"]')?.click();
    });
}
