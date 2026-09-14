const urlElement = document.getElementById("tagger-url");
const alternativeElement = document.getElementById("alternative");
const statusElement = document.getElementById("status");
const qrElement = document.getElementById("tagger-qr");

// Force a fresh QR whenever this window opens. The LAN address can change
// between barn sessions even though the image URL itself stays the same.
qrElement.src = `/qr.png?t=${Date.now()}`;

fetch("/tagger-info")
  .then((response) => {
    if (!response.ok) throw new Error("No se pudo obtener la dirección del tagger.");
    return response.json();
  })
  .then(({ url, friendlyUrl }) => {
    urlElement.textContent = url;
    urlElement.href = url;
    if (friendlyUrl && friendlyUrl !== url) {
      alternativeElement.textContent = `También puedes escribir: ${friendlyUrl}`;
    }
  })
  .catch((error) => {
    urlElement.removeAttribute("href");
    urlElement.textContent = "Dirección no disponible";
    statusElement.textContent = error.message;
  });
