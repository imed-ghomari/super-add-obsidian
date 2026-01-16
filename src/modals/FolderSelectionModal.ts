import { App, Modal, Setting, TFolder, TFile, getAllTags } from 'obsidian';
import SuperAddPlugin from '../../main';

export interface FolderSelectionOptions {
    callback: (folderPath: string) => void;
    initialFolder?: string;
}

/**
 * Modal for selecting a destination folder for tasks.
 */
export class FolderSelectionModal extends Modal {
    private plugin: SuperAddPlugin;
    private options: FolderSelectionOptions;
    private folders: string[] = [];
    private filteredFolders: string[] = [];
    private searchInput: HTMLInputElement;
    private folderList: HTMLElement;
    private selectedFolder: string = '';

    constructor(app: App, plugin: SuperAddPlugin, options: FolderSelectionOptions) {
        super(app);
        this.plugin = plugin;
        this.options = options;
        this.selectedFolder = options.initialFolder || this.plugin.settings.defaultFolder;
    }

    onOpen() {
        const { contentEl } = this;

        // Set modal title
        contentEl.createEl('h2', { text: 'Select Destination Folder' });

        // Create search input
        this.createSearchInput(contentEl);

        // Create folder list
        this.createFolderList(contentEl);

        // Create action buttons
        this.createActionButtons(contentEl);

        // Load folders
        this.loadFolders();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Creates the search input for filtering folders.
     */
    private createSearchInput(container: HTMLElement) {
        const searchContainer = container.createDiv({ cls: 'folder-search-container' });

        new Setting(searchContainer)
            .setName('Search')
            .setDesc('Filter folders by name')
            .addText(text => {
                this.searchInput = text.inputEl;
                text.setPlaceholder('Type to filter folders...')
                    .onChange(value => {
                        this.filterFolders(value);
                    });

                // Set initial focus
                setTimeout(() => {
                    this.searchInput.focus();
                }, 10);
            });
    }

    /**
     * Creates the folder list container.
     */
    private createFolderList(container: HTMLElement) {
        const listContainer = container.createDiv({ cls: 'folder-list-container' });
        this.folderList = listContainer.createDiv({ cls: 'folder-list' });
    }

    /**
     * Creates action buttons for the modal.
     */
    private createActionButtons(container: HTMLElement) {
        const buttonContainer = container.createDiv({ cls: 'folder-button-container' });

        // Cancel button
        new Setting(buttonContainer)
            .addButton(button => {
                button.setButtonText('Cancel')
                    .onClick(() => {
                        this.close();
                    });
            })
            .addButton(button => {
                button.setButtonText('Select')
                    .setCta()
                    .onClick(() => {
                        this.selectFolder();
                    });
            });
    }

    /**
     * Loads all folders from the vault.
     */
    private loadFolders() {
        this.folders = [];

        // Add root folder
        this.folders.push('/');

        // Get all folders in the vault
        const files = this.app.vault.getAllLoadedFiles();
        for (const file of files) {
            if (file instanceof TFolder) {
                this.folders.push(file.path);
            }
        }

        // Sort folders
        this.folders.sort((a, b) => {
            if (a === '/') return -1;
            if (b === '/') return 1;
            return a.localeCompare(b);
        });

        this.filteredFolders = [...this.folders];
        this.renderFolderList();
    }

    /**
     * Filters folders based on search input.
     */
    private filterFolders(search: string) {
        if (!search) {
            this.filteredFolders = [...this.folders];
        } else {
            const lowerSearch = search.toLowerCase();
            this.filteredFolders = this.folders.filter(folder => 
                folder.toLowerCase().includes(lowerSearch)
            );
        }

        this.renderFolderList();
    }

    /**
     * Renders the folder list.
     */
    private renderFolderList() {
        this.folderList.empty();

        if (this.filteredFolders.length === 0) {
            this.folderList.createEl('div', { 
                text: 'No folders found', 
                cls: 'folder-empty-message' 
            });
            return;
        }

        for (const folder of this.filteredFolders) {
            const folderItem = this.folderList.createEl('div', { 
                cls: 'folder-list-item' 
            });

            // Add selected class if this is the selected folder
            if (folder === this.selectedFolder) {
                folderItem.addClass('folder-selected');
            }

            // Display folder name
            const displayName = folder === '/' ? 'Root' : folder;
            folderItem.createEl('span', { text: displayName });

            // Add click handler
            folderItem.addEventListener('click', () => {
                // Remove selected class from all items
                this.folderList.querySelectorAll('.folder-selected').forEach(el => {
                    el.removeClass('folder-selected');
                });

                // Add selected class to this item
                folderItem.addClass('folder-selected');

                // Update selected folder
                this.selectedFolder = folder;
            });

            // Add double-click handler to immediately select
            folderItem.addEventListener('dblclick', () => {
                this.selectedFolder = folder;
                this.selectFolder();
            });
        }
    }

    /**
     * Selects the current folder and calls the callback.
     */
    private selectFolder() {
        if (this.selectedFolder) {
            this.options.callback(this.selectedFolder);
            this.close();
        }
    }
}