let EXTENSION_CACHE = {};
const LOG_LEVEL = 'error'; // Возможные значения: 'debug', 'info', 'warn', 'error', 'none'
const DISK_API_URL = 'https://disk.yandex.ru/models-v2?m=mpfs/dir-size'; // Для личного диска
const SHARE_API_URL = 'https://disk.yandex.ru/public/api/get-dir-size'; // Для публичных папок


resetCache();

function resetCache() {
    EXTENSION_CACHE['folderSizeCache'] = {};
    EXTENSION_CACHE['diskSK'] = null;
    EXTENSION_CACHE['cachedStoreData'] = null;
    EXTENSION_CACHE['shareSK'] = null;
    EXTENSION_CACHE['shareHash'] = null;
}

function log(level, ...messages) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(LOG_LEVEL);
    const messageLevelIndex = levels.indexOf(level);
    if (messageLevelIndex >= currentLevelIndex) {
        console[level](...messages);
    }
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === "triggerGetSizes") {
        await getAllFoldersSize();
    }
});

let popupSortState = 0;
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sortFoldersBySize') {
        if (popupSortState === 0) {
            sortFoldersBySize('desc'); // Сортировка по убыванию
        } else {
            sortFoldersBySize('asc'); // Сортировка по возрастанию
        }
        popupSortState = (popupSortState + 1) % 2;
        sendResponse({status: 'success', message: 'Файлы отсортированы по размеру'});
    }
});

async function addSortButton() {
    const addedSortButton = document.querySelector('.Super-Button-Show-Disk');
    if (addedSortButton) {
        log('debug','Кнопка сортировки уже добавлена');
        return addedSortButton
    }

    let listingHead;
    for (let i = 0; i < 5; i++) {
        listingHead = document.querySelector('div.listing-head__listing-settings');
        if (!listingHead) {
            await wait(1000);
        } else {
            break;
        }
    }
    if (!listingHead) {
        log('error', 'Элемент div.listing-head не найден');
        return;
    }

    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'Button2 Button2_size_m Select2-Button Super-Button-Show-Disk';
    sortButton.setAttribute('aria-haspopup', 'true');
    sortButton.setAttribute('aria-expanded', 'false');
    sortButton.setAttribute('aria-multiselectable', 'true');
    sortButton.setAttribute('aria-label', 'Сортировать по размеру');
    sortButton.setAttribute('aria-pressed', 'false');
    sortButton.setAttribute('autocomplete', 'off');
    sortButton.setAttribute('role', 'listbox');

    const buttonContent = document.createElement('span');
    buttonContent.className = 'Button2-Text';
    buttonContent.textContent = 'По размеру';

    sortButton.style.background = 'linear-gradient(to right, #ffffe0, #ffa161)';
    sortButton.style.marginRight = '8px'; // Отступ справа
    sortButton.style.borderRadius = '8px';
    sortButton.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)'; // Серая тень

    sortButton.appendChild(buttonContent);
    listingHead.insertBefore(sortButton, listingHead.firstChild);

    log('debug','Кнопка сортировки добавлена');
    return sortButton;
}

async function setupSortButton() {
    const sortButton = await addSortButton();
    if (!sortButton) return;

    let sortState = 0;

    sortButton.addEventListener('click', () => {
        if (sortState === 0) {
            sortFoldersBySize('desc'); // Сортировка по убыванию
        } else {
            sortFoldersBySize('asc'); // Сортировка по возрастанию
        }
        sortState = (sortState + 1) % 2;
    });
    log('debug','Обработчик клика на кнопку сортировки настроен');
}

function getApiUrl() {
    const currentUrl = window.location.href;

    if (currentUrl.includes('https://disk.yandex.ru/client/disk')) {
        return DISK_API_URL;
    } else if (currentUrl.includes('https://disk.yandex.ru/d')) {
        return SHARE_API_URL;
    } else {
        log('error', 'Неизвестный URL:', currentUrl);
        return null;
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findTargetNode(retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        const targetNode = document.querySelector('div.listing__items');
        if (targetNode) {
            return targetNode;
        }
        log('debug',`Попытка ${i + 1}: элемент не найден, повтор через ${delay / 1000} секунд...`);
        await wait(delay); // Ждём перед следующей попыткой
        if (i === 0) {
            delay = 2000; // Увеличиваем задержку после первой попытки
        }
    }
    log('error', 'Элемент div.listing__items не найден после всех попыток');
    return null;
}


function setupMenuClickListener() {
    const popup = document.querySelector('div.root__content-container');
    if (!popup) {
        log('error','Элемент div.Popup2 не найден');
        return;
    }
    popup.addEventListener('click', async (event) => {
        // Проверяем, был ли клик на элементе с классом Menu-Item
        const menuItem = event.target.closest('.Menu-Item');
        if (menuItem) {
            log('debug','Нажат элемент Menu-Item:', menuItem);
            await wait(500);
            await getAllFoldersSize();
            await setupSortButton();
        }
    });
    log('debug','Наблюдение за кликами на Menu-Item в div.Popup2 настроено');
}

// Функция для обработки папок
async function processFolders() {
    const targetNode = await findTargetNode();
    if (!targetNode) return;

    const folders = targetNode.querySelectorAll('div.listing-item_type_dir');
    if (folders.length === 0) {
        log('debug', 'Папки не найдены');
        return;
    }

    const sk = getSk();
    for (const folder of folders) {
        const sizeElement = folder.querySelector('.listing-item__column_size');
        if (!sizeElement || !sizeElement.textContent.trim()) {
            const currentPath = getCurrentPath();
            await fetchFolderSize(currentPath, folder, sk);
        }
    }
}

chrome.storage.sync.get('autoLoadSizesEnabled', async (data) => {
    if (data.autoLoadSizesEnabled) {
        let lastPathname = window.location.pathname;
        // Функция для отслеживания изменений URL
        async function watchUrlChanges() {
            const observer = new MutationObserver(async () => {
                const currentPathname = window.location.pathname;
                if (lastPathname !== currentPathname) {
                    log('debug', 'URL изменился:', currentPathname);
                    lastPathname = currentPathname;
                    resetCache();
                    await setupSortButton();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            log('debug', 'Observer запущен для отслеживания изменений URL');
            return observer;
        }
        // Проверяем папки каждые 3 секунды
        const intervalId = setInterval(processFolders, 3000);
        // Отслеживаем изменения URL
        const urlObserver = watchUrlChanges();
        // Очистка при остановке расширения
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && changes.autoLoadSizesEnabled) {
                if (!changes.autoLoadSizesEnabled.newValue) {
                    clearInterval(intervalId); // Останавливаем интервал
                    urlObserver.disconnect(); // Отключаем обсервер
                    log('debug', 'Расширение остановлено');
                }
            }
        });
        // Следим за кликами по сортировке
        await setupMenuClickListener();
        // Первая обработка папок
        await processFolders();
        await setupSortButton();
    }
});


function formatSize(bytes) {
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    if (bytes === 0) return '0 Б';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2).toString().replace('.', ',') + ' ' + sizes[i];
}

function getPreloadedData() {
    const scriptElement = document.querySelector('script#preloaded-data');
    if (!scriptElement) {
        log('debug', 'Элемент preloaded-data не найден.');
        return null;
    }
    return JSON.parse(scriptElement.textContent);
}

function getSkFromData() {
    if (EXTENSION_CACHE['diskSK']) {
        return EXTENSION_CACHE['diskSK'];
    }
    const data = getPreloadedData();
    if (data && data.config && data.config.sk) {
        EXTENSION_CACHE['diskSK'] = data.config.sk;
        return data.config.sk;
    }
    log('debug', 'Не удалось получить sk из preloaded-data.');
    return null;
}

function getStorePrefetchData() {
    if (EXTENSION_CACHE['cachedStoreData']) {
        return EXTENSION_CACHE['cachedStoreData'];
    }
    const scriptElement = document.querySelector('script#store-prefetch');
    if (!scriptElement) {
        log('debug', 'Элемент <script id="store-prefetch"> не найден');
        return null;
    }
    const cachedStoreData = JSON.parse(scriptElement.textContent);
    EXTENSION_CACHE['cachedStoreData'] = cachedStoreData;
    return cachedStoreData;
}

function getSkFromStorePrefetch() {
    if (EXTENSION_CACHE['shareSK']) {
        return EXTENSION_CACHE['shareSK'];
    }
    const storeData = getStorePrefetchData();
    if (!storeData) {
        return null;
    }
    if (storeData?.environment?.sk) {
        EXTENSION_CACHE['shareSK'] = storeData.environment.sk;
        return storeData.environment.sk;
    } else {
        log('debug', 'Не удалось найти environment.sk в данных');
        return null;
    }
}

function getSk() {
    const skFromData = getSkFromData();
    if (skFromData) {
        log('debug', 'sk получен из getSkFromData:', skFromData);
        return skFromData;
    }
    const skFromStorePrefetch = getSkFromStorePrefetch();
    if (skFromStorePrefetch) {
        log('debug', 'sk получен из getSkFromStorePrefetch:', skFromStorePrefetch);
        return skFromStorePrefetch;
    }
    log('error', 'Не удалось получить sk ни из getSkFromData, ни из getSkFromStorePrefetch');
    return null;
}

function getHash() {
    if (EXTENSION_CACHE['shareHash']) {
        return EXTENSION_CACHE['shareHash'];
    }
    const storeData = getStorePrefetchData();
    if (!storeData?.resources) {
        log('error', 'Не удалось найти resources в storeData');
        return null;
    }
    // Ищем ресурс, содержащий ключ hash
    let hash = null;
    for (const key in storeData.resources) {
        if (storeData.resources[key]?.hash) {
            hash = storeData.resources[key].hash;
            break;
        }
    }
    if (!hash) {
        log('error', 'Не удалось найти hash в resources');
        return null;
    }
    EXTENSION_CACHE['shareHash'] = hash;
    log('debug', 'HASH: ', EXTENSION_CACHE['shareHash']);
    return hash;
}

function getFullPath(currentPath, path) {
    return currentPath ? `${currentPath}/${path}` : `/${path}`;
}

function getTrashSize() {
    const data = getPreloadedData();
    if (data && data.space && data.space.trash != null) {
        return data.space.trash;
    }
    log('error', 'Не удалось получить размер корзины.');
    return 0;
}

function getCurrentPath() {
    let currentPath = decodeURIComponent(window.location.pathname);
    if (currentPath.startsWith('/client')) {
        currentPath = currentPath.replace('/client', '');
    }
    if (currentPath.startsWith('/d/')) {
        const match = currentPath.match(/\/d\/[^\/]+(\/[^\/]+)/);
        if (!match) {
            log('debug', 'Не удалось извлечь родительскую папку из URL: ', currentPath);
            return null;
        }
        currentPath = match[1];
    }
    return currentPath;
}

function updateFolderSize(folderElement, size) {
    const sizeElement = folderElement.querySelector('.listing-item__column.listing-item__column_size');
    if (sizeElement) sizeElement.textContent = size;
}

async function fetchFolderSize(parentPath, folderElement, sk) {
    const childPath = folderElement.querySelector('.listing-item__title').textContent.trim();
    if (parentPath === '/trash') { // Пока не умею обрабатывать файлы в корзине
        return;
    }

    const fullPath = getFullPath(parentPath, childPath);
    if (EXTENSION_CACHE['folderSizeCache'][fullPath]) {
        log('debug', `Размер папки "${fullPath}" взят из кэша:`, EXTENSION_CACHE['folderSizeCache'][fullPath]);
        updateFolderSize(folderElement, EXTENSION_CACHE['folderSizeCache'][fullPath]);
        return;
    }

    if (fullPath === '/disk/Корзина') {
        const trashSize = getTrashSize();
        updateFolderSize(folderElement, formatSize(trashSize));
        return;
    }

    const apiUrl = getApiUrl();
    try {
        let response;
        let payload;
        let headers = {
            'Content-Type': 'application/json',
            'Cookie': document.cookie,
        };

        if (apiUrl === DISK_API_URL) {
            payload = JSON.stringify({
                sk,
                apiMethod: "mpfs/dir-size",
                requestParams: {path: fullPath},
            });
        } else if (apiUrl === SHARE_API_URL) {
            const hashPrefix = getHash();
            const hash = `${hashPrefix}:${fullPath}`;
            log('debug', 'HASH FOR REQUEST: ', hash);
            payload = encodeURIComponent(JSON.stringify({hash, sk}));
            headers['Content-Type'] = 'text/plain';
        } else {
            log('debug', 'Неизвестный API URL:', apiUrl);
            return;
        }
        response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: payload,
        });

        if (!response.ok) {
            log('error', `HTTP ошибка! Статус: ${response.status}`);
            return;
        }
        const data = await response.json();
        let size;
        if (apiUrl === DISK_API_URL) {
            size = data.size; // Для DISK_API_URL размер находится в data.size
        } else if (apiUrl === SHARE_API_URL) {
            size = data.data.size; // Для SHARE_API_URL размер находится в data.data.size
        } else {
            log('debug', 'Неизвестный API URL:', apiUrl);
            return;
        }
        const formattedSize = formatSize(size);
        EXTENSION_CACHE['folderSizeCache'][fullPath] = formattedSize;
        log('debug', `Размер папки "${fullPath}" сохранён в кэш:`, formattedSize);
        // Обновляем размер в интерфейсе
        updateFolderSize(folderElement, formattedSize);
    } catch (error) {
        log('error', 'Ошибка при получении размера:', error);
    }
}

function getFolderElements() {
    const folders = document.querySelectorAll('div.listing-item_type_dir');
    if (folders.length === 0) {
        log('debug', "Папки не найдены");
        return null;
    }
    return folders;
}

async function getAllFoldersSize() {
    let parentPath = getCurrentPath();
    const sk = getSk();
    if (!sk) return;
    const folders = getFolderElements();
    for (const childFolderElem of folders) {
        await fetchFolderSize(parentPath, childFolderElem, sk);
    }
}

function sortFoldersBySize(order) {
    const items = Array.from(document.querySelectorAll('div.listing-item'));
    const itemsData = items.map(folder => {
        const sizeElement = folder.querySelector('.listing-item__column.listing-item__column_size');
        if (!sizeElement) return {size: 0, element: folder}; // Если размер не найден, считаем его 0
        const sizeText = sizeElement.textContent.trim();
        const sizeBytes = parseSize(sizeText);
        return {size: sizeBytes, element: folder};
    });
    if (order === 'desc') {
        itemsData.sort((a, b) => b.size - a.size);
    } else {
        itemsData.sort((a, b) => a.size - b.size);
    }
    const container = document.querySelector('div.listing__items');
    if (!container) {
        log('error', 'Контейнер listing__items не найден');
        return;
    }
    itemsData.forEach(data => {
        container.appendChild(data.element);
    });
    log('debug', 'Файлы отсортированы по убыванию размера');
}

function parseSize(sizeText) {
    let previewSize = sizeText.replace('байт', 'Б');
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const regex = /^([\d,]+)\s*(\S+)$/; // Пример: "123.45 МБ"
    const match = previewSize.match(regex);
    if (!match) {
        log('debug', 'Не смог распарсить размер', sizeText)
        return 0;
    }
    const value = parseFloat(match[1]);
    const unit = match[2];
    const index = sizes.indexOf(unit);
    if (index === -1) return 0;
    return value * Math.pow(1024, index); // Преобразуем в байты
}