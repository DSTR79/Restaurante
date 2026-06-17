/* keyboard.js */
const Keyboard = {
  elements: {
    main: null,
    keysContainer: null,
    keys: []
  },

  currentInput: null,

  init() {
    // Crear contenedor
    this.elements.main = document.createElement("div");
    this.elements.main.classList.add("virtual-keyboard");
    document.body.appendChild(this.elements.main);

    this._createKeys();

    // Escuchar eventos de foco en inputs
    document.addEventListener("focusin", (e) => {
      if (e.target.tagName === "INPUT" && (e.target.type === "text" || e.target.type === "password" || e.target.type === "number")) {
        this.open(e.target);
      }
    });

    // Cerrar si se hace click fuera
    document.addEventListener("mousedown", (e) => {
      if (this.elements.main.contains(e.target)) return;
      if (this.currentInput && this.currentInput === e.target) return;
      this.close();
    });
  },

  _createKeys() {
    const layout = [
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
      ["Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
      ["SPACE", "ENTER"]
    ];

    layout.forEach(row => {
      const rowElement = document.createElement("div");
      rowElement.classList.add("keyboard-row");

      row.forEach(key => {
        const keyElement = document.createElement("button");
        keyElement.classList.add("key");
        keyElement.type = "button";
        keyElement.textContent = key;

        switch (key) {
          case "BACKSPACE":
            keyElement.classList.add("wide", "danger");
            keyElement.innerHTML = "⌫";
            keyElement.addEventListener("click", () => this._handleKeyPress("BACKSPACE"));
            break;
          case "SPACE":
            keyElement.classList.add("wide");
            keyElement.innerHTML = "ESPACIO";
            keyElement.addEventListener("click", () => this._handleKeyPress(" "));
            break;
          case "ENTER":
            keyElement.classList.add("wide", "success");
            keyElement.innerHTML = "OK";
            keyElement.addEventListener("click", () => this.close());
            break;
          default:
            keyElement.addEventListener("click", () => this._handleKeyPress(key.toUpperCase()));
            break;
        }

        rowElement.appendChild(keyElement);
      });

      this.elements.main.appendChild(rowElement);
    });
  },

  _handleKeyPress(key) {
    if (!this.currentInput) return;

    const start = this.currentInput.selectionStart;
    const end = this.currentInput.selectionEnd;
    const value = this.currentInput.value;

    if (key === "BACKSPACE") {
      this.currentInput.value = value.substring(0, start - 1) + value.substring(end);
      this.currentInput.setSelectionRange(start - 1, start - 1);
    } else {
      this.currentInput.value = value.substring(0, start) + key + value.substring(end);
      this.currentInput.setSelectionRange(start + 1, start + 1);
    }

    // Disparar evento input para que JS de la página se entere
    this.currentInput.dispatchEvent(new Event("input", { bubbles: true }));
    this.currentInput.focus();
  },

  open(inputElement) {
    this.currentInput = inputElement;
    this.elements.main.classList.add("active");
  },

  close() {
    this.currentInput = null;
    this.elements.main.classList.remove("active");
  }
};

document.addEventListener("DOMContentLoaded", () => Keyboard.init());
