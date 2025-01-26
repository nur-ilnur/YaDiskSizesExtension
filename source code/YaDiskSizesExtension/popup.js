document.addEventListener('DOMContentLoaded', () => {
  const autoLoadSizesToggle = document.getElementById('autoLoadSizesToggle');
  const getSizesButton = document.getElementById('getSizes');
  const sortButton = document.getElementById('sortButton');

  // Загружаем сохранённое состояние чекбокса
  chrome.storage.sync.get('autoLoadSizesEnabled', (data) => {
    autoLoadSizesToggle.checked = data.autoLoadSizesEnabled || false;
  });

  // Сохраняем состояние чекбокса при изменении
  autoLoadSizesToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoLoadSizesEnabled: autoLoadSizesToggle.checked });
  });

  sortButton.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'sortFoldersBySize' });
    });
  });

  getSizesButton.addEventListener('click', () => {
    chrome.tabs.query({ active: true }, function (tabs) {
      var tab = tabs[0];
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: "triggerGetSizes" });
      } else {
        alert("There are no active tabs")
      }
    })
  });
});
