if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log('Service Worker зарегистрирован успешно!'))
        .catch(err => console.error('Ошибка Service Worker:', err));
}


const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const btnStart = document.getElementById('btn-start');
const btnSnap = document.getElementById('btn-snap');
const statusDiv = document.getElementById('status');
const historyDiv = document.getElementById('history');

let db;
let stream = null;


const dbRequest = indexedDB.open("ReceiptScannerDB", 1);
dbRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("receipts")) {
        db.objectStoreNames.createObjectStore("receipts", { keyPath: "id", autoIncrement: true });
    }
};
dbRequest.onsuccess = (e) => {
    db = e.target.result;
    renderHistory();
};

function saveReceipt(type, content) {
    const transaction = db.transaction(["receipts"], "readwrite");
    const store = transaction.objectStore("receipts");
    const item = {
        type: type, 
        content: content,
        date: new Date().toLocaleString()
    };
    store.add(item).onsuccess = () => renderHistory();
}

function renderHistory() {
    historyDiv.innerHTML = "";
    const transaction = db.transaction(["receipts"], "readonly");
    const store = transaction.objectStore("receipts");
    
    store.openCursor(null, "prev").onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const div = document.createElement('div');
            div.className = 'receipt-card';
            div.innerHTML = `
                <strong>[${cursor.value.type}] - ${cursor.value.date}</strong>
                <pre>${cursor.value.content}</pre>
            `;
            historyDiv.appendChild(div);
            cursor.continue();
        } else if (historyDiv.innerHTML === "") {
            historyDiv.innerHTML = "<p style='text-align:center;'>Нет сохраненных чеков</p>";
        }
    };
}


btnStart.addEventListener('click', async () => {
    try {
        if (stream) {
            stopCamera();
            return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" }, 
            audio: false 
        });
        video.srcObject = stream;
        video.style.display = 'block';
        btnSnap.style.display = 'block';
        btnStart.textContent = "Выключить камеру";
        statusDiv.textContent = "Камера готова. Наведите на чек или QR-код.";
    } catch (err) {
        statusDiv.textContent = "Ошибка доступа к камере: " + err.message;
    }
});

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.style.display = 'none';
    btnSnap.style.display = 'none';
    btnStart.textContent = "Включить камеру";
    statusDiv.textContent = "";
}


btnSnap.addEventListener('click', async () => {
    if (!stream) return;

    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    statusDiv.textContent = "Анализ кадра...";
    btnSnap.disabled = true;

    
    if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        try {
            const barcodes = await detector.detect(canvas);
            if (barcodes.length > 0) {
                statusDiv.textContent = "Найден QR-код!";
                saveReceipt("QR-Code", barcodes[0].rawValue);
                btnSnap.disabled = false;
                stopCamera();
                return;
            }
        } catch (e) {
            console.error("Сбой детектора штрихкодов:", e);
        }
    }

    
    statusDiv.textContent = "QR не найден. Запуск OCR текста (Tesseract)...";
    
    try {
        
        const result = await Tesseract.recognize(canvas, 'rus+eng', {
            logger: m => { if(m.status === 'recognizing') statusDiv.textContent = `OCR: ${Math.round(m.progress * 100)}%`; }
        });
        
        const extractedText = result.data.text.trim();
        if (extractedText) {
            saveReceipt("Text OCR", extractedText);
            statusDiv.textContent = "Текст успешно извлечен!";
        } else {
            statusDiv.textContent = "Не удалось прочитать текст. Попробуйте еще раз при лучшем освещении.";
        }
    } catch (err) {
        statusDiv.textContent = "Ошибка распознавания: " + err.message;
    } finally {
        btnSnap.disabled = false;
        stopCamera();
    }
});