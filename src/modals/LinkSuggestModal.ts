import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class LinkSuggestModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(item: TFile): string {
        return item.basename;
    }

    onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(item);
    }

    // Override to customize the modal title
    onOpen() {
        void super.onOpen();
        this.modalEl.querySelector('.modal-title')?.setText('Select a file to link');
    }
}
