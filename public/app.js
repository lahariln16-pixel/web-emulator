const urlInput = document.getElementById("url");
const goButton = document.getElementById("go");

const backButton = document.getElementById("back");
const forwardButton = document.getElementById("forward");
const reloadButton = document.getElementById("reload");

const screen = document.getElementById("screen");

let socket;
let lastObjectUrl = null;
let browserImage = null;

function connectToBrowser() {

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";

    socket = new WebSocket(`${protocol}//${location.host}`);

    socket.binaryType = "blob";

    socket.onopen = () => {
        console.log("Connected to remote Chromium");
    };

    socket.onmessage = (event) => {

        const imageUrl = URL.createObjectURL(event.data);
        const image = new Image();

        image.onload = () => {

            if (lastObjectUrl) {
                URL.revokeObjectURL(lastObjectUrl);
            }

            lastObjectUrl = imageUrl;

        };

        image.src = imageUrl;

        image.style.width = "100%";
        image.style.height = "100%";
        image.style.objectFit = "contain";

        image.draggable = false;

        browserImage = image;

        screen.innerHTML = "";
        screen.appendChild(image);
    };

    socket.onclose = () => {

        console.log("Remote browser disconnected");

        setTimeout(connectToBrowser, 2000);
    };
}

function sendInput(data) {

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

screen.tabIndex = 0;

screen.addEventListener("pointerdown", (event) => {

    if (!browserImage) {
        return;
    }

    screen.focus();

    const rect = browserImage.getBoundingClientRect();

    const x = (event.clientX - rect.left)
        * (1280 / rect.width);

    const y = (event.clientY - rect.top)
        * (720 / rect.height);

    sendInput({
        type: "click",
        x: x,
        y: y
    });

});

screen.addEventListener("wheel", (event) => {

    event.preventDefault();

    sendInput({
        type: "wheel",
        deltaX: event.deltaX,
        deltaY: event.deltaY
    });

}, { passive: false });

screen.addEventListener("keydown", (event) => {

    event.preventDefault();

    if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
    ) {

        sendInput({
            type: "keydown",
            text: event.key
        });

        return;
    }

    const modifiers = [];

    if (event.ctrlKey) modifiers.push("Control");
    if (event.shiftKey) modifiers.push("Shift");
    if (event.altKey) modifiers.push("Alt");
    if (event.metaKey) modifiers.push("Meta");

    sendInput({
        type: "keydown",
        key: event.key,
        modifiers: modifiers
    });

});

screen.addEventListener("keyup", (event) => {

    if (event.key.length === 1) {
        return;
    }

    sendInput({
        type: "keyup",
        key: event.key
    });

});

async function sendCommand(endpoint, body = {}) {

    try {

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        console.log("Server response:", data);

        if (data.success) {
            urlInput.value = data.url;
        }

    } catch (error) {

        console.error("Command error:", error);

    }
}

goButton.addEventListener("click", () => {

    sendCommand("/navigate", {
        url: urlInput.value
    });

});

backButton.addEventListener("click", () => {
    sendCommand("/back");
});

forwardButton.addEventListener("click", () => {
    sendCommand("/forward");
});

reloadButton.addEventListener("click", () => {
    sendCommand("/reload");
});

urlInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {
        goButton.click();
    }

});

connectToBrowser();
