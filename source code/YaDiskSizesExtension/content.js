chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "triggerGetSizes") {
    getAllFoldersSize();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sortFoldersBySize') {
    sortFoldersBySize(); // Вызов функции сортировки
    sendResponse({ status: 'success', message: 'Файлы отсортированы по размеру' });
  }
});


chrome.storage.sync.get('autoLoadSizesEnabled', (data) => {
  if (data.autoLoadSizesEnabled) {
    let lastPathname = window.location.pathname;

    // Функция для проверки наличия div.listing__items
    function checkForListingItems(attempt = 1) {
      const listingItems = document.querySelector('div.listing__items');
      if (listingItems && listingItems.children.length > 0) {
        console.log("Элементы подгружены, начинаем обновление размеров...");
        getAllFoldersSize();
      } else if (attempt < 4) {
        console.log(`Попытка ${attempt} не удалась, пробуем снова...`);
        setTimeout(() => checkForListingItems(attempt + 1), attempt * 1000);
      } else {
        console.log("Не удалось найти элементы за 4 попытки.");
      }
    }

    // Создаем MutationObserver для отслеживания изменений в DOM
    const observer = new MutationObserver((mutationsList, observer) => {

      // Проверяем, если URL изменился (например, на новую папку)
      const currentPathname = window.location.pathname;
      if (lastPathname && currentPathname !== lastPathname) {
        console.log("Путь изменился:", currentPathname);
        checkForListingItems();
        lastPathname = currentPathname;
      }
    });

    // Начинаем отслеживание изменений в DOM
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    checkForListingItems();
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
    console.error('Элемент preloaded-data не найден.');
    return null;
  }
  return JSON.parse(scriptElement.textContent);
}

function getSkFromData() {
  const data = getPreloadedData();
  if (data && data.config && data.config.sk) {
    return data.config.sk;
  }
  console.error('Не удалось получить sk из preloaded-data.');
  return null;
}

function getFullPath(currentPath, path) {
  return `${currentPath}/${path}`;
}

function getTrashSize() {
  const data = getPreloadedData();
  if (data && data.space && data.space.trash != null) {
    return data.space.trash;
  }
  console.error('Не удалось получить размер корзины.');
  return 0;
}

function fetchFolderSize(path, currentPath, folderElement, sk) {
  if (currentPath === '/trash') {
    // Пока не умею обрабатывать файлы в корзине
    return;
  }

  const fullPath = getFullPath(currentPath, path);

  if (fullPath === '/disk/Корзина') {
    const trashSize = getTrashSize();
    const formattedSize = formatSize(trashSize);
    const sizeElement = folderElement.querySelector('.listing-item__column.listing-item__column_size');
    if (sizeElement) sizeElement.textContent = formattedSize;
    return;
  }

  fetch('https://disk.yandex.ru/models-v2?m=mpfs/dir-size', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': document.cookie
    },
    body: JSON.stringify({
      "sk": sk,
      "apiMethod": "mpfs/dir-size",
      "requestParams": {
        "path": fullPath
      }
    })
  }).then(response => {
    if (!response.ok) {
      throw new Error(`HTTP ошибка! Статус: ${response.status}`);
    }
    return response.json();
  })
    .then(data => {
      const formattedSize = formatSize(data.size);

      // Добавляем размер в блок папки
      const sizeElement = folderElement.querySelector('.listing-item__column.listing-item__column_size');
      if (sizeElement) sizeElement.textContent = formattedSize;
    })
    .catch(error => console.error('Ошибка запроса:', error));
}


function getAllFoldersSize() {
  let currentPath = decodeURIComponent(window.location.pathname);
  if (currentPath.startsWith('/client')) {
    currentPath = currentPath.replace('/client', ''); // Убираем "/client" из начала
  }

  // Получаем sk только один раз
  const sk = getSkFromData();
  if (!sk) return; // Если sk не найден, выходим из функции

  // Находим все папки и обновляем их размеры
  const folders = document.querySelectorAll('div.listing-item_type_dir');
  if (folders.length === 0) {
    console.log("Ничего не нашел");
    return;
  }

  folders.forEach((folder) => {
    const path = folder.querySelector('.listing-item__title').textContent.trim();
    fetchFolderSize(path, currentPath, folder, sk);
  });
}


function sortFoldersBySize() {
  const items = Array.from(document.querySelectorAll('div.listing-item'));

  const itemsData = items.map(folder => {
    const sizeElement = folder.querySelector('.listing-item__column.listing-item__column_size');
    if (!sizeElement) return { size: 0, element: folder }; // Если размер не найден, считаем его 0
    const sizeText = sizeElement.textContent.trim();
    const sizeBytes = parseSize(sizeText);
    return { size: sizeBytes, element: folder };
  });

  itemsData.sort((a, b) => b.size - a.size);

  const container = document.querySelector('div.listing__items');
  if (!container) {
    console.error('Контейнер listing__items не найден');
    return;
  }

  itemsData.forEach(data => {
    container.appendChild(data.element);
  });

  console.log('Файлы отсортированы по убыванию размера');
}

// Функция для преобразования размера из строки в байты
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