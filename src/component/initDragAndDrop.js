function initDragAndDrop() {
  const cryptoList = document.getElementById('crypto-list');
  let draggedItem = null;

  // Add event listeners to each crypto-item-container
  document.querySelectorAll('.crypto-item-container').forEach(container => {
      const cryptoItem = container.querySelector('.crypto-item');
      
      cryptoItem.setAttribute('draggable', true);
      
      cryptoItem.addEventListener('dragstart', (e) => {
          draggedItem = container;
          container.classList.add('dragging');
          e.dataTransfer.setData('text/plain', ''); // Required for Firefox
      });

      cryptoItem.addEventListener('dragend', () => {
          container.classList.remove('dragging');
          draggedItem = null;
          
          // Save the new order
          const newOrder = Array.from(cryptoList.querySelectorAll('.crypto-item'))
              .map(item => `${item.dataset.symbol}/${item.dataset.pair}`);
          
          // Update trackedCryptos array
          trackedCryptos = newOrder;
          
          // Notify main process about the new order
          ipcRenderer.send('update-crypto-order', newOrder);
      });
  });

  cryptoList.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedItem) return;

      const afterElement = getDragAfterElement(cryptoList, e.clientY);
      if (afterElement) {
          cryptoList.insertBefore(draggedItem, afterElement);
      } else {
          cryptoList.appendChild(draggedItem);
      }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.crypto-item-container:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      
      if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
      } else {
          return closest;
      }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

module.exports = initDragAndDrop;