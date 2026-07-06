/* Remote — special key sequences for the KVM viewer (X11 keysyms as [keycode, down]). */
var RemoteKeys = {
    win: { label: 'Windows key', seq: [[0xffe7, 1], [0xffe7, 0]] },
    winD: { label: 'Win + D (Desktop)', seq: [[0xffe7, 1], [0x64, 1], [0x64, 0], [0xffe7, 0]] },
    winL: { label: 'Win + L (Lock)', seq: [[0xffe7, 1], [0x6c, 1], [0x6c, 0], [0xffe7, 0]] },
    winR: { label: 'Win + R (Run)', seq: [[0xffe7, 1], [0x72, 1], [0x72, 0], [0xffe7, 0]] },
    winE: { label: 'Win + E (Explorer)', seq: [[0xffe7, 1], [0x65, 1], [0x65, 0], [0xffe7, 0]] },
    winUp: { label: 'Win + Up', seq: [[0xffe7, 1], [0xff52, 1], [0xff52, 0], [0xffe7, 0]] },
    winDown: { label: 'Win + Down', seq: [[0xffe7, 1], [0xff54, 1], [0xff54, 0], [0xffe7, 0]] },
    winLeft: { label: 'Win + Left', seq: [[0xffe7, 1], [0xff51, 1], [0xff51, 0], [0xffe7, 0]] },
    winRight: { label: 'Win + Right', seq: [[0xffe7, 1], [0xff53, 1], [0xff53, 0], [0xffe7, 0]] },
    altTab: { label: 'Alt + Tab', seq: [[0xffe9, 1], [0xff09, 1], [0xff09, 0], [0xffe9, 0]] },
    altF4: { label: 'Alt + F4', seq: [[0xffe9, 1], [0xffc1, 1], [0xffc1, 0], [0xffe9, 0]] },
    ctrlW: { label: 'Ctrl + W', seq: [[0xffe3, 1], [0x77, 1], [0x77, 0], [0xffe3, 0]] },
    ctrlEsc: { label: 'Ctrl + Esc (Start)', seq: [[0xffe3, 1], [0xff1b, 1], [0xff1b, 0], [0xffe3, 0]] },
    esc: { label: 'Escape', seq: [[0xff1b, 1], [0xff1b, 0]] },
    f1: { label: 'F1', seq: [[0xffbe, 1], [0xffbe, 0]] }, f2: { label: 'F2', seq: [[0xffbf, 1], [0xffbf, 0]] },
    f3: { label: 'F3', seq: [[0xffc0, 1], [0xffc0, 0]] }, f4: { label: 'F4', seq: [[0xffc1, 1], [0xffc1, 0]] },
    f5: { label: 'F5', seq: [[0xffc2, 1], [0xffc2, 0]] }, f6: { label: 'F6', seq: [[0xffc3, 1], [0xffc3, 0]] },
    f7: { label: 'F7', seq: [[0xffc4, 1], [0xffc4, 0]] }, f8: { label: 'F8', seq: [[0xffc5, 1], [0xffc5, 0]] },
    f9: { label: 'F9', seq: [[0xffc6, 1], [0xffc6, 0]] }, f10: { label: 'F10', seq: [[0xffc7, 1], [0xffc7, 0]] },
    f11: { label: 'F11', seq: [[0xffc8, 1], [0xffc8, 0]] }, f12: { label: 'F12', seq: [[0xffc9, 1], [0xffc9, 0]] }
};
