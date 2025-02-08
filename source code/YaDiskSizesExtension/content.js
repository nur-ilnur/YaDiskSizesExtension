let EXTESION_CACHE = {};
const LOG_LEVEL = 'debug'; // Возможные значения: 'debug', 'info', 'warn', 'error', 'none'
const DISK_API_URL = 'https://disk.yandex.ru/models-v2?m=mpfs/dir-size'; // Для личного диска
const SHARE_API_URL = 'https://disk.yandex.ru/public/api/get-dir-size'; // Для публичных папок


resetCache();

function resetCache() {
    EXTESION_CACHE['folderSizeCache'] = {};
    EXTESION_CACHE['diskSK'] = null;
    EXTESION_CACHE['cachedStoreData'] = null;
    EXTESION_CACHE['shareSK'] = null;
    EXTESION_CACHE['shareHash'] = null;
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sortFoldersBySize') {
        sortFoldersBySize(); // Вызов функции сортировки
        sendResponse({status: 'success', message: 'Файлы отсортированы по размеру'});
    }
});

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

chrome.storage.sync.get('autoLoadSizesEnabled', async (data) => {
    if (data.autoLoadSizesEnabled) {
        let lastPathname = window.location.pathname;
        // Получаем элемент div с классом 'listing__items'
        const targetNode = document.querySelector('div.listing__items');
        const currentPath = getCurrentPath();
        const sk = getSk();

        if (targetNode) {
            // Проверяем, есть ли уже папки в DOM
            const initialFolders = targetNode.querySelectorAll('div.listing-item_type_dir');
            if (initialFolders.length > 0) {
                log('debug', 'Найдены существующие папки:', initialFolders.length);
                for (const folder of initialFolders) {
                    await fetchFolderSize(currentPath, folder, sk);
                }
            }
            // Создаем MutationObserver для отслеживания изменений в DOM
            const observer = new MutationObserver(async (mutationsList, observer) => {
                // Проверяем, если URL изменился (например, на новую папку)
                const currentPathname = window.location.pathname;
                if (lastPathname && currentPathname !== lastPathname) {
                    log('debug', "Путь изменился:", currentPathname);
                    resetCache();
                    lastPathname = currentPathname;
                }
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('listing-item') && node.classList.contains('listing-item_type_dir')) {
                                await fetchFolderSize(currentPath, node, sk);
                            }
                        }
                    }
                }
            });

            observer.observe(targetNode, {
                childList: true,
                attributes: true,
                subtree: true
            });
            log('debug', 'Observer запущен для div.listing__items');
        } else {
            log('error', 'Элемент div.listing__items не найден');
        }
    }
});


function formatSize(bytes) {
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    if (bytes === 0) return '0 Б';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
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
    if (EXTESION_CACHE['diskSK']) {
        return EXTESION_CACHE['diskSK'];
    }
    const data = getPreloadedData();
    if (data && data.config && data.config.sk) {
        EXTESION_CACHE['diskSK'] = data.config.sk;
        return data.config.sk;
    }
    log('debug', 'Не удалось получить sk из preloaded-data.');
    return null;
}

function getStorePrefetchData() {
    if (EXTESION_CACHE['cachedStoreData']) {
        return EXTESION_CACHE['cachedStoreData'];
    }
    const scriptElement = document.querySelector('script#store-prefetch');
    if (!scriptElement) {
        log('debug', 'Элемент <script id="store-prefetch"> не найден');
        return null;
    }
    const cachedStoreData = JSON.parse(scriptElement.textContent);
    EXTESION_CACHE['cachedStoreData'] = cachedStoreData;
    return cachedStoreData;
}

function getSkFromStorePrefetch() {
    if (EXTESION_CACHE['shareSK']) {
        return EXTESION_CACHE['shareSK'];
    }
    const storeData = getStorePrefetchData();
    if (!storeData) {
        return null;
    }
    if (storeData?.environment?.sk) {
        EXTESION_CACHE['shareSK'] = storeData.environment.sk;
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
    if (EXTESION_CACHE['shareHash']) {
        return EXTESION_CACHE['shareHash'];
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
    EXTESION_CACHE['shareHash'] = hash;
    return hash;
}

function getFullPath(currentPath, path) {
    return `${currentPath}/${path}`;
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
        const match = currentPath.match(/\/d\/[^\/]+\/([^\/]+)/);
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
    if (parentPath === '/trash') {
        // Пока не умею обрабатывать файлы в корзине
        return;
    }

    const fullPath = getFullPath(parentPath, childPath);
    // Проверяем кэш
    if (EXTESION_CACHE['folderSizeCache'][fullPath]) {
        log('debug', `Размер папки "${fullPath}" взят из кэша:`, EXTESION_CACHE['folderSizeCache'][fullPath]);
        updateFolderSize(folderElement, EXTESION_CACHE['folderSizeCache'][fullPath]);
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
            const hash = getHash();
            if (!hash) {
                log('error', 'Не удалось получить hash для SHARE_API_URL');
                return;
            }
            payload = new URLSearchParams(JSON.stringify({hash, sk,})).toString();
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
        EXTESION_CACHE['folderSizeCache'][fullPath] = formattedSize;
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

function sortFoldersBySize() {
    const items = Array.from(document.querySelectorAll('div.listing-item'));
    const itemsData = items.map(folder => {
        const sizeElement = folder.querySelector('.listing-item__column.listing-item__column_size');
        if (!sizeElement) return {size: 0, element: folder}; // Если размер не найден, считаем его 0
        const sizeText = sizeElement.textContent.trim();
        const sizeBytes = parseSize(sizeText);
        return {size: sizeBytes, element: folder};
    });

    itemsData.sort((a, b) => b.size - a.size);
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
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const regex = /^([\d.]+)\s*(\S+)$/; // Пример: "123.45 МБ"
    const match = sizeText.match(regex);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2];
    const index = sizes.indexOf(unit);
    if (index === -1) return 0;
    return value * Math.pow(1024, index); // Преобразуем в байты
}