import { App, FuzzySuggestModal, TFolder, setIcon, FuzzyMatch } from 'obsidian';
import SuperAddPlugin from '../../main';

export interface FolderSelectionOptions {
    callback: (folderPath: string) => void;
    initialFolder?: string;
}

/**
 * Modal for selecting a destination folder for tasks using fuzzy search.
 * This modal is similar to Obsidian's quick switcher.
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    private plugin: SuperAddPlugin;
    private callback: (folderPath: string) => void;
    private initialFolder: string;

    constructor(app: App, plugin: SuperAddPlugin, options: FolderSelectionOptions) {
        super(app);
        this.plugin = plugin;
        this.callback = options.callback;
        this.initialFolder = options.initialFolder || this.plugin.settings.defaultFolder;
        
        // Set modal title for accessibility
        this.setPlaceholder('Type to search for folders...');
        this.setInstructions([
            { command: '↑↓', purpose: 'to navigate' },
            { command: '↵', purpose: 'to select' },
            { command: 'esc', purpose: 'to cancel' }
        ]);
    }

    getItems(): TFolder[] {
        // Get all folders from the vault
        const folders: TFolder[] = [];
        const rootFolder = this.app.vault.getRoot();
        
        // Add root folder
        folders.push(rootFolder);
        
        // Recursively add all subfolders
        const addFolders = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    folders.push(child);
                    addFolders(child);
                }
            }
        };
        
        addFolders(rootFolder);
        return folders;
    }

    getItemText(folder: TFolder): string {
        return folder.path === '/' ? '/ (root)' : folder.path;
    }

    onChooseItem(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
        this.callback(folder.path);
    }

    renderSuggestion(item: FuzzyMatch<TFolder>, el: HTMLElement): void {
        super.renderSuggestion(item, el);
        
        // Add folder icon
        const iconContainer = createSpan({ cls: 'suggestion-icon' });
        el.prepend(iconContainer);
        setIcon(iconContainer, 'folder');
        
        // Highlight if this is the initial folder
        if (item.item.path === this.initialFolder) {
            el.addClass('is-selected');
        }
    }
}
