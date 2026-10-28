<template lang="pug">
    BlockUI.overflow-hidden(ref="blockUi")
        BackgroundComponent(
            v-show="loadingMessage !== ''"
        )
        BlockingMessageComponent(
            :message="loadingMessage"
            v-show="loadingMessage !== ''"
        )
        Toast(
            :id="toastId"
            :class="compIsActive ? 'visible' : 'invisible'"
            :group="toastId"
            :pt:root:style="{ position: 'absolute' }"
        )
        .h-dvh.flex.flex-col
            .flex.items-baseline
                MainMenu(
                :id="mainMenuId"
                    :arrowStyle="arrowStyle"
                    :haveFile="haveFile"
                    :fileModified="fileModified"
                    :editorStatus="editorStatus"
                    :noPython="noPython"
                    :viewState="viewState"
                    @about="onAboutMenu"
                    @edit-action="onEditAction"
                    @export-action="onExportAction"
                    @file-action="onFileAction"
                    @menu-active="onMenuActive"
                    @view-action="onViewAction"
                )
                div.flex-grow.text-center.font-bold {{ windowTitle }}
                div.text-xs.pr-2(
                    v-if="!updateAvailable"
                ) v{{ version.currentVersion }}
                button.update-link.flex.mr-1.text-xs.cursor-pointer.rounded-sm.border.border-transparent.bg-transparent(
                    v-if="updateAvailable"
                    class="px-1.5 py-0.5"
                    type="button"
                    title="Click to reload and update"
                    @click="onUpdateClick"
                ) New version available!
                ToggleButton.editor-dark-selector(
                    v-model="darkMode"
                    offIcon="pi pi-sun"
                    onIcon="pi pi-moon"
                    size="small"
                    @change="onDarkMode"
                )
            ConfirmDialog
                template(#message="slotProps")
                    i(:class="slotProps.message.icon" style="font-size: 2rem;")
                    span {{ slotProps.message.message }}
            CellDLEditor.grow(
                :editorCommand="editorCommand"
                :options="editorOptions"
                :chrome="appChrome"
                :elementInfo="devElementInfo"
                :arrowStyle="arrowStyle"
                :wheelMode="wheelMode"
                :theme="editorTheme"
                @diagramChanged="onDiagramChanged"
                @elements="onElements"
                @elementResult="onElementResult"
                @editorData="onEditorData"
                @error="onError"
            )
            AboutDialog(
                v-model:visible="aboutVisible"
                @close="aboutVisible = false"
            )
            Dialog.issues(
                v-model:visible="issuesVisible"
                modal=""
            )
                template(#header)
                    .flex.w-full
                        p.text-2xl.font-bold Issues generating CellML:
                        .grow
                        Button(
                            icon="pi pi-copy"
                            title="Copy to clipboard"
                            @click="copyIssuesToClipboard"
                        )
                div
                    p.mb-1(
                        v-for="issue in issues"
                    ) {{ issue }}
</template>

<style>
.editor-dark-selector .p-togglebutton-label {
    display: none;
}
</style>

<style scoped>
.update-link {
    color: var(--p-primary-color);
}

.update-link:hover {
    background-color: var(--p-content-hover-background);
    border-color: var(--p-content-border-color);
}
</style>

<script setup lang="ts">
import * as vue from 'vue'
import * as vueusecore from '@vueuse/core'

import 'primeicons/primeicons.css'

import primeVueAuraTheme from '@primeuix/themes/aura'
import primeVueConfig from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice';
import primeVueToastService from 'primevue/toastservice';
import { useConfirm } from "primevue/useconfirm"
import { useToast } from 'primevue/usetoast';

//==============================================================================

import '../assets/app.css'

import AboutDialog from './dialogs/AboutDialog.vue'

import { OPEN_LINK_DELAY, SHORT_DELAY } from '../utils/constants'
import { celldl2cellml } from '../utils/cellml'
import { isCompatibleBrowser } from '../utils/common'
import { decodeCellDLLink, loadFromLink } from '../utils/openLink'
import { safeCellDL } from '../utils/safeCellDL'
import * as version from '../utils/version'
import * as vueCommon from '../utils/vueCommon'

import CellDLEditor from '../../../src'

import type {
    ElementInfoById,
    ArrowStyle,
    CellDLEditorCommand,
    EditorChrome,
    DiagramChange,
    EditorData,
    ElementResult,
    ElementsChange,
    FileStatus,
    SvgViewerOptions,
    Theme,
    ViewState,
    WheelMode
} from '../../../src'
import { editorInitialised, EditorStatus } from '../../../src'
import { DEFAULT_VIEW_STATE } from '../../../src'
import { ARROW_STYLES, DEFAULT_ARROW_STYLE } from '../../../src'

//==============================================================================

type IEditorAppProps = {
    theme?: Theme
    noPython?: boolean
}

const props = defineProps<IEditorAppProps>()

//==============================================================================

// Wait for the editor component to become ready

const loadingMessage = vue.ref<string>('Loading CellDL editor');

(function checkInitialised() {
  setTimeout(() => {
    if (editorInitialised()) {
        loadingMessage.value = ''
        console.log('Editor ready...')

        // Open the document in a `?open=celldl#<base64>` link, or the CellDL file at `?open=<url>` (a link with no
        // hash), once the editor component has mounted
        setTimeout(() => {
            const open = new URLSearchParams(window.location.search).get('open')
            if (window.location.hash) {
                openLinkedDocument()
            } else if (open) {
                openUrlFile(open)
            }
        }, OPEN_LINK_DELAY)

        // Now start checking for a newer version of the editor
        version.startCheck()
    } else {
        checkInitialised()
    }
  }, 50)
})()

//==============================================================================
//==============================================================================

// Setup PrimeVue's theme and confirmation service

const crtInstance = vue.getCurrentInstance();

if (crtInstance) {
    const app = crtInstance.appContext.app;

    if (!app.config.globalProperties.$primevue) {
        app.use(primeVueConfig as unknown as vue.Plugin, {
            theme: {
                preset: primeVueAuraTheme,
                options: {
                    darkModeSelector: '.celldl-dark-mode'
                }
            }
        })
    }

    if (!app.config.globalProperties.$confirm) {
        app.use(ConfirmationService as unknown as vue.Plugin)
    }

    if (!app.config.globalProperties.$toast) {
        app.use(primeVueToastService as unknown as vue.Plugin)
    }
}

vueCommon.useTheme().setTheme(props.theme)

const confirm = useConfirm()

const toast = useToast()

const blockUi = vue.ref<vue.ComponentPublicInstance | null>(null)
const toastId = vue.ref('editorToast')
const mainMenuId = vue.ref('editorMainMenu')
const activeInstanceUid = vueCommon.activeInstanceUid()

//==============================================================================

const editorTheme = vue.ref<Theme|undefined>(props.theme)

const darkMode = vue.ref<boolean>(props.theme === 'dark')

function onDarkMode() {
    if (darkMode.value) {
        editorTheme.value = 'dark'
    } else {
        editorTheme.value = 'light'
    }
    vueCommon.useTheme().setTheme(editorTheme.value)
}

//==============================================================================

// Keep track of which instance of the CellDL Editor is currently active.

function activateInstance(): void {
    activeInstanceUid.value = String(crtInstance?.uid)
}

const compIsActive = vue.computed(() => {
    return activeInstanceUid.value === String(crtInstance?.uid)
})

vue.onMounted(() => {
    const blockUiElement = blockUi.value?.$el as HTMLElement

    // Let the user know their browser is not supported

    vue.nextTick().then(() => {
        if (!isCompatibleBrowser()) {
             confirm.require({
                header: 'Incompatible browser...',
                message: `Either Google Chrome or Microsoft Edge is needed to open and save CellDL diagrams.`,
                icon: 'pi pi-exclamation-triangle',
                rejectClass: 'invisible',
                acceptProps: {
                    label: 'OK'
                }
            })
        }
    })

    // Customise our IDs.

    toastId.value = `editorToast${String(crtInstance?.uid)}`
    mainMenuId.value = `opencorMainMenu${String(crtInstance?.uid)}`

    // Make ourselves the active instance.

    setTimeout(() => {
        activateInstance()
    }, SHORT_DELAY)

    // Ensure that our toasts are shown within our block UI.

    setTimeout(() => {
        const toastElement = document.getElementById(toastId.value)

        if (toastElement) {
            blockUiElement.appendChild(toastElement)
        }
    }, SHORT_DELAY)
})

async function openUrlFile(url: string) {
    const response = await fetch(url)
    if (!response.ok) {
        onError(`Cannot open ${url}: ${response.status} ${response.statusText}`)
        return
    }
    // A file from a URL may come from anywhere, so nothing in it may run
    openDocument(safeCellDL(await response.text()), decodeURIComponent(url.split('/').pop() || url))
}

//==============================================================================
//==============================================================================

const editorCommand = vue.ref<CellDLEditorCommand>()

//==============================================================================

const windowTitle = vue.ref<string>('New diagram')

const fileStatus = vue.ref<FileStatus>({
    haveData: false,
    modified: false
})

const beforeUnloadHandler = (event: Event) => {
    event.preventDefault()
}

function diagramModified(modified: boolean) {
    fileStatus.value.modified = modified
    if (modified) {
        window.addEventListener("beforeunload", beforeUnloadHandler)
    } else {
        window.removeEventListener("beforeunload", beforeUnloadHandler)
    }
}

const haveFile = vue.computed(() => {
    return fileStatus.value.haveData
})

const fileModified = vue.computed(() => {
    return fileStatus.value.modified
})

let currentFileHandle: FileSystemFileHandle|undefined

//==============================================================================
//==============================================================================

vueusecore.useEventListener(document, 'file-edited', (_: Event) => {
    fileStatus.value.haveData = true
    diagramModified(true)
    if (!windowTitle.value.endsWith(' *')) {
        windowTitle.value += ' *'
    }
})

//==============================================================================

function onDiagramChanged(change: DiagramChange) {
    console.debug(`diagram-changed: revision ${change.revision}, ${change.rdf.length} bytes of RDF`)
}

//==============================================================================

// In development, let a test (e.g. Playwright) drive the `element` command:
// `window.celldlDev.command(cmd)` sends a command, and `elements` and
// `results` collect what the editor emits

const editorOptions: SvgViewerOptions = { elementList: import.meta.env.DEV }

// and set the editor's `chrome` and `annotations` (with `options.tooltip`)
// from `?chrome=<json>` and `?elementInfo=<json>`, as a host would

function devParameter<T>(name: string): T|undefined {
    if (!import.meta.env.DEV) {
        return undefined
    }
    const value = new URLSearchParams(window.location.search).get(name)
    try {
        return value ? JSON.parse(value) as T : undefined
    } catch {
        console.error(`?${name} is not JSON`)
        return undefined
    }
}

const devChrome = devParameter<EditorChrome>('chrome')
// The app shows every right-hand panel, unless `?chrome=` chooses
const appChrome: EditorChrome = devChrome ?? {
    panels: ['properties', 'metadata', 'style', 'reactions', 'variables', 'annotations']
}
const devElementInfo = devParameter<ElementInfoById>('elementInfo')
if (devElementInfo) {
    editorOptions.tooltip = 'tooltip'
}

const devElements: ElementsChange[] = []
const devResults: ElementResult[] = []

function onElements(change: ElementsChange) {
    devElements.push(change)
}

function onElementResult(result: ElementResult) {
    devResults.push(result)
}

if (import.meta.env.DEV) {
    (window as unknown as { celldlDev: object }).celldlDev = {
        command: (command: CellDLEditorCommand) => { editorCommand.value = command },
        elements: devElements,
        results: devResults
    }
}

//==============================================================================

async function onEditorData(data: EditorData) {
    if (data.kind === 'export') {
        await saveCellML(data.data)
    } else if (data.kind === 'save-as' || !currentFileHandle) {
        await saveFile(data.data)
    } else if (currentFileHandle) {
        await writeFileData(currentFileHandle, data.data)
    }
}

//==============================================================================

function onError(msg: string) {
    window.alert(msg)
}

//==============================================================================
//==============================================================================

async function onFileAction(action: string) {
    if (action === 'new') {
        await onNewFile()
    } else if (action === 'open') {
        await onOpenFile()
    } else if (action === 'save') {
        await onSaveFile(false)
    } else if (action === 'save-as') {
        await onSaveFile(true)
    }
}

//==============================================================================

async function onNewFile() {
    if (!fileStatus.value.modified) {
        closeFile()
    } else {
        confirm.require({
            message: 'Close modified diagram?',
            header: 'Confirmation',
            icon: 'pi pi-exclamation-triangle',
            rejectProps: {
                label: 'Cancel',
                severity: 'secondary',
                outlined: true
            },
            acceptProps: {
                label: 'Close'
            },
            accept: () => {
                closeFile()
            }
        })
    }
}

function closeFile() {
    editorCommand.value = {
        command: 'file',
        options: {
            action: 'close'
        }
    }
    currentFileHandle = undefined
    fileStatus.value.haveData = false
    diagramModified(false)
    windowTitle.value = 'New diagram'
}

//==============================================================================

async function onOpenFile() {
    if (!fileStatus.value.modified) {
        await openFile()
    } else {
        confirm.require({
            message: 'Overwrite modified diagram?',
            header: 'Confirmation',
            icon: 'pi pi-exclamation-triangle',
            rejectProps: {
                label: 'Cancel',
                severity: 'secondary',
                outlined: true
            },
            acceptProps: {
                label: 'Open'
            },
            accept: async () => {
                await openFile()
            }
        })
    }
}

async function openFile() {
    const options = {
        excludeAcceptAllOption: true,
        types: [
            {
                description: 'CellDL files',
                accept: {
                    'image/svg+xml': ['.celldl', '.svg'],
                }
            }
        ]
    }
    const fileHandles = await window.showOpenFilePicker(options)
    if (fileHandles.length) {
        currentFileHandle = fileHandles[0]
        if (currentFileHandle) {
            const file = await currentFileHandle.getFile()
            openDocument(await file.text(), currentFileHandle.name)
        }
    }
}

function openDocument(contents: string, name: string) {
    editorCommand.value = {
        command: 'file',
        options: {
            action: 'open',
            data: contents,
            name: name
        }
    }
    fileStatus.value.haveData = true
    diagramModified(false)
    windowTitle.value = name
}

// Opens the CellDL document in `?open=celldl#<base64>` (named by an optional `&name=`, else "Linked diagram")
async function openLinkedDocument() {
    const name = new URLSearchParams(window.location.search).get('name') || 'Linked diagram'
    await loadFromLink({
        celldl: (data: string) => {
            // A link's document may come from anywhere, so nothing in it may run
            openDocument(safeCellDL(decodeCellDLLink(data)), name)
        }
    }, onError)
}

//==============================================================================

async function onSaveFile(saveAs: boolean=false) {
    editorCommand.value = {
        command: 'file',
        options: {
            action: 'data',
            kind: saveAs || !currentFileHandle ? 'save-as' : 'save'
        }
    }
}

async function saveFile(celldl: string) {
    const fileName = currentFileHandle?.name || undefined
    const options = {
        types: [
            {
                description: 'CellDL files',
                accept: {
                    'image/svg+xml': ['.svg', '.celldl'],
                }
            }
        ],
        suggestedName: fileName
    }
    const fileHandle = await window.showSaveFilePicker(options).catch(() => {})
    if (fileHandle) {
        await writeFileData(fileHandle, celldl)
        currentFileHandle = fileHandle
    }
}

async function writeFileData(fileHandle: FileSystemFileHandle, data: string) {
    const writableStream = await fileHandle.createWritable()
    await writableStream.write(data)
    await writableStream.close()
    diagramModified(false)
    windowTitle.value = fileHandle.name
    editorCommand.value = {
        command: 'edit',
        options: {
            action: 'clean'
        }
    }
}

//==============================================================================
//==============================================================================

async function onExportAction(action: string) {
    if (action === 'cellml') {
        editorCommand.value = {
            command: 'file',
            options: {
                action: 'data',
                kind: 'export'
            }
        }
    }
}

const issues = vue.ref<string[]>([])
const issuesVisible = vue.ref(false)

function copyIssuesToClipboard() {
    navigator.clipboard.writeText(issues.value.join('\n'))
}

async function saveCellML(celldl: string) {
    let fileName = 'Untitled.cellml'
    if (currentFileHandle) {
        if (currentFileHandle.name.endsWith('.')) {
            fileName = currentFileHandle.name + 'cellml'
        } else {
            const parts = currentFileHandle.name.split('.')
            if (parts.length === 1) {
                fileName = currentFileHandle.name + '.cellml'
            } else {
                fileName = parts.slice(0, -1).join('.') + '.cellml'
            }
        }
    }
    const options = {
        types: [
            {
                description: 'CellML files',
                accept: {
                    'application/cellml+xml': ['.cellml'],
                }
            }
        ],
        suggestedName: fileName
    }
    const fileHandle = await window.showSaveFilePicker(options).catch(() => {})
    if (fileHandle) {
        const cellmlObject = await celldl2cellml(`https://celldl.org/cellml/${encodeURIComponent(fileHandle.name)}`, celldl)
        if (cellmlObject.cellml) {
            const writableStream = await fileHandle.createWritable()
            await writableStream.write(cellmlObject.cellml)
            await writableStream.close()
            toast.add({
                severity: 'info',
                group: toastId.value,
                summary: 'CellML created',
                detail: `Saved as ${fileHandle.name}`
            })
        } else if (cellmlObject.issues?.length) {
            issues.value = cellmlObject.issues
            issuesVisible.value = true
        } else {
            window.alert(cellmlObject.exception ?? 'Unexpected exception generating CellML...')
        }
    }
}

//==============================================================================
//==============================================================================

function onMenuActive() {
    editorCommand.value = {
        command: 'set-state',
        options: {
            action: 'reset-tools'
        }
    }
}

//==============================================================================

const editorStatus = vue.computed<EditorStatus>(() => {
    return new EditorStatus()
})

function onEditAction(action: string) {
    editorCommand.value = {
        command: 'edit',
        options: {
            action: action
        }
    }
}

//==============================================================================

const viewState = vue.ref<ViewState>({ ...DEFAULT_VIEW_STATE })

//==============================================================================

// Bonds' arrowheads, the viewer's choice: from `?arrowStyle=` (for tests) or as last chosen

const ARROW_STYLE_KEY = 'celldl-editor-arrow-style'

function initialArrowStyle(): ArrowStyle {
    let style: string|null = new URLSearchParams(window.location.search).get('arrowStyle')
    if (!style) {
        try {
            style = window.localStorage.getItem(ARROW_STYLE_KEY)
        } catch {
            style = null
        }
    }
    return ARROW_STYLES.includes(style as ArrowStyle) ? style as ArrowStyle : DEFAULT_ARROW_STYLE
}

const arrowStyle = vue.ref<ArrowStyle>(initialArrowStyle())

function setArrowStyle(style: ArrowStyle) {
    arrowStyle.value = style
    try {
        window.localStorage.setItem(ARROW_STYLE_KEY, style)
    } catch {
        // Not remembered
    }
}

// What a plain wheel does over the diagram, from `?wheelMode=` (for tests)
const wheelMode = (new URLSearchParams(window.location.search).get('wheelMode') ?? undefined) as WheelMode|undefined

function onViewAction(action: string, value: number|boolean|string) {
    if (action === 'arrow-style') {
        setArrowStyle(value as ArrowStyle)
    } else if (action === 'show-grid') {
        viewState.value = { ...viewState.value, showGrid: !!value }
        editorCommand.value = {
            command: 'view',
            options: viewState.value
        }
    } else if (action === 'show-guides') {
        viewState.value = { ...viewState.value, alignmentGuides: !!value }
        editorCommand.value = {
            command: 'view',
            options: viewState.value
        }
    } else if (action === 'snap-to-grid') {
        viewState.value = { ...viewState.value, snapToGrid: Number(value) }
        editorCommand.value = {
            command: 'view',
            options: viewState.value
        }
    }
}

//==============================================================================
//==============================================================================

// About dialog.

const aboutVisible = vue.ref<boolean>(false)

function onAboutMenu(): void {
  aboutVisible.value = true
}


//==============================================================================
//==============================================================================

// Handle the click on the update link button by showing a Yes/No dialog.

const updateConfirmVisible = vue.ref(false)
const updateAvailable = version.updateAvailable
const latestVersion = version.latestVersion

const onUpdateClick = () => {
    confirm.require({
        header: 'Update Available...',
        message: `Version '${latestVersion.value}' is available. Do you want to reload and update now?`,
        icon: 'pi pi-info-circle',
        rejectProps: {
            label: 'No',
            severity: 'secondary',
            outlined: true
        },
        acceptProps: {
            label: 'Yes'
        },
        accept: () => {
            version.reloadApp()
        }
    })
}

//==============================================================================
//==============================================================================

</script>
