import { useRef, useCallback, useState, useEffect } from 'react'
import { usePlanner } from '../state'
import { exportToPNG } from '../canvas'
import { clearAutosave, useJarImport } from '../hooks'
import { EXPORT_SCALE } from '@/data/presets'
import {
  createProjectFile,
  downloadProjectJSON,
  loadProjectFromFile,
  downloadDataURL,
  deserializeStructures,
  deserializeHullTiles,
  deserializeUserLayers,
  deserializeUserGroups,
  DEFAULT_PROJECT_NAME,
  buildProjectFilename,
} from '@/lib/serialization'
import {
  chooseExportDirectory,
  dataURLToBlob,
  isExportDirectorySupported,
  loadExportDirectory,
  writeExportFile,
  type ExportDirectoryHandle,
} from '@/lib/exportDestination'
import { clearJarCatalogCache } from '@/data/jarCatalog'
import { capture } from '@/lib/analytics'
import { JarImportDialog } from './JarImportDialog'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './ActionBar.module.css'

const PROJECT_METADATA_STORAGE_KEY = 'space-haven-planner-project-metadata'

interface ProjectMetadataState {
  projectName: string
  revision: number
}

function loadProjectMetadata(): ProjectMetadataState {
  try {
    const stored = localStorage.getItem(PROJECT_METADATA_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ProjectMetadataState>
      return {
        projectName:
          typeof parsed.projectName === 'string' && parsed.projectName.trim()
            ? parsed.projectName
            : DEFAULT_PROJECT_NAME,
        revision:
          typeof parsed.revision === 'number' && Number.isFinite(parsed.revision)
            ? Math.max(0, Math.floor(parsed.revision))
            : 0,
      }
    }
  } catch {
    // Ignore invalid local metadata and fall back to defaults.
  }

  return { projectName: DEFAULT_PROJECT_NAME, revision: 0 }
}

function saveProjectMetadata(metadata: ProjectMetadataState): void {
  try {
    localStorage.setItem(PROJECT_METADATA_STORAGE_KEY, JSON.stringify(metadata))
  } catch {
    // Ignore storage errors; explicit JSON saves still contain the metadata.
  }
}

export function ActionBar() {
  const { state, dispatch } = usePlanner()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    selectJarFile,
    fileInputRef: jarInputRef,
    onFileInputChange: onJarInputChange,
  } = useJarImport(dispatch)
  const [isJarDialogOpen, setIsJarDialogOpen] = useState(false)
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadataState>(loadProjectMetadata)
  const [exportDirectory, setExportDirectory] = useState<ExportDirectoryHandle | null>(null)
  const [confirmKind, setConfirmKind] = useState<
    null | 'clear_all' | 'new_project' | 'reset_catalog'
  >(null)
  const exportDirectorySupported = isExportDirectorySupported()

  useEffect(() => {
    saveProjectMetadata(projectMetadata)
  }, [projectMetadata])

  useEffect(() => {
    let cancelled = false

    void loadExportDirectory().then((handle) => {
      if (!cancelled) {
        setExportDirectory(handle)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const resetProjectMetadata = useCallback(() => {
    setProjectMetadata({ projectName: DEFAULT_PROJECT_NAME, revision: 0 })
  }, [])

  const handleProjectNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const projectName = e.target.value
    setProjectMetadata((prev) => ({
      projectName,
      revision: projectName === prev.projectName ? prev.revision : 0,
    }))
  }, [])

  const handleProjectNameBlur = useCallback(() => {
    setProjectMetadata((prev) => ({
      ...prev,
      projectName: prev.projectName.trim() || DEFAULT_PROJECT_NAME,
    }))
  }, [])

  const saveBlobToExportDirectory = useCallback(
    async (filename: string, blob: Blob): Promise<boolean> => {
      if (!exportDirectory) return false

      try {
        const written = await writeExportFile(exportDirectory, filename, blob)
        if (!written) {
          alert('Export folder permission was not granted. The file will be downloaded instead.')
        }
        return written
      } catch (err) {
        console.error('Failed to write to export folder:', err)
        alert('Could not write to the selected export folder. The file will be downloaded instead.')
        return false
      }
    },
    [exportDirectory]
  )

  const handleChooseExportDirectory = useCallback(async () => {
    try {
      const handle = await chooseExportDirectory()
      if (!handle) return

      setExportDirectory(handle)
      capture('export_folder_selected')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return

      console.error('Failed to select export folder:', err)
      alert('Failed to select export folder')
    }
  }, [])

  const handleSave = useCallback(async () => {
    const nextRevision = projectMetadata.revision + 1
    const project = createProjectFile(
      state.gridSize,
      state.presetLabel,
      state.structures,
      state.hullTiles,
      state.userLayers,
      state.userGroups,
      state.activeLayerId,
      {
        projectName: projectMetadata.projectName,
        revision: nextRevision,
      }
    )
    const filename = buildProjectFilename(project)
    const json = JSON.stringify(project, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const savedToFolder = await saveBlobToExportDirectory(filename, blob)

    if (!savedToFolder) {
      downloadProjectJSON(project, filename)
    }

    setProjectMetadata({ projectName: project.projectName, revision: project.revision })
    capture('project_save_json', {
      structures_count: state.structures.length,
      hull_tiles_count: state.hullTiles.size,
      preset: state.presetLabel,
      revision: project.revision,
      destination: savedToFolder ? 'folder' : 'download',
    })
  }, [
    projectMetadata,
    saveBlobToExportDirectory,
    state.gridSize,
    state.presetLabel,
    state.structures,
    state.hullTiles,
    state.userLayers,
    state.userGroups,
    state.activeLayerId,
  ])

  const handleLoadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      try {
        const project = await loadProjectFromFile(file)

        // Load the project into state
        dispatch({
          type: 'SET_PRESET',
          presetLabel: project.preset,
          gridSize: project.gridSize,
        })

        const structures = deserializeStructures(project.structures)
        dispatch({ type: 'LOAD_STRUCTURES', structures })

        // Load hull tiles (v3+)
        const hullTiles = deserializeHullTiles(project.hullTiles)
        dispatch({ type: 'LOAD_HULL_TILES', tiles: hullTiles })

        // Load user layers and groups (v4+)
        const userLayers = deserializeUserLayers(project.userLayers)
        const userGroups = deserializeUserGroups(project.userGroups)
        dispatch({
          type: 'LOAD_USER_LAYERS',
          layers: userLayers,
          groups: userGroups,
          activeLayerId: project.activeLayerId,
        })

        // v5+ files carry their own name/revision. Older files parse to safe defaults.
        setProjectMetadata({
          projectName: project.projectName,
          revision: project.revision,
        })

        capture('project_load_success', {
          structures_count: structures.length,
          hull_tiles_count: hullTiles.length,
          preset: project.preset,
          revision: project.revision,
        })
      } catch (err) {
        console.error('Failed to load project:', err)
        alert(`Failed to load project: ${err instanceof Error ? err.message : String(err)}`)
        capture('project_load_error')
      }

      // Reset file input
      e.target.value = ''
    },
    [dispatch]
  )

  const handleExportPNG = useCallback(async () => {
    try {
      const dataURL = exportToPNG(
        state.gridSize,
        state.structures,
        state.hullTiles,
        state.catalog,
        { userLayers: state.userLayers, userGroups: state.userGroups },
        EXPORT_SCALE
      )
      const pngFilename = buildProjectFilename(projectMetadata).replace(/\.json$/, '.png')
      const savedToFolder = exportDirectory
        ? await saveBlobToExportDirectory(pngFilename, dataURLToBlob(dataURL))
        : false

      if (!savedToFolder) {
        downloadDataURL(dataURL, pngFilename)
      }

      capture('export_png_success', {
        structures_count: state.structures.length,
        hull_tiles_count: state.hullTiles.size,
        preset: state.presetLabel,
        revision: projectMetadata.revision,
        destination: savedToFolder ? 'folder' : 'download',
      })
    } catch (err) {
      console.error('Failed to export PNG:', err)
      alert('Failed to export PNG')
      capture('export_png_error')
    }
  }, [
    exportDirectory,
    projectMetadata,
    saveBlobToExportDirectory,
    state.gridSize,
    state.structures,
    state.hullTiles,
    state.catalog,
    state.userLayers,
    state.userGroups,
    state.presetLabel,
  ])

  const handleClear = useCallback(() => {
    const hasAnything = state.structures.length > 0 || state.hullTiles.size > 0
    if (!hasAnything) return

    setConfirmKind('clear_all')
  }, [state.structures.length, state.hullTiles.size])

  const handleNewProject = useCallback(() => {
    const hasAnything = state.structures.length > 0 || state.hullTiles.size > 0
    if (!hasAnything) {
      dispatch({ type: 'NEW_PROJECT' })
      clearAutosave()
      resetProjectMetadata()
      capture('project_new')
      return
    }

    setConfirmKind('new_project')
  }, [state.structures.length, state.hullTiles.size, dispatch, resetProjectMetadata])

  const handleResetCatalog = useCallback(() => {
    setConfirmKind('reset_catalog')
  }, [])

  const handleCloseConfirm = useCallback(() => {
    setConfirmKind(null)
  }, [])

  const handleConfirm = useCallback(() => {
    if (confirmKind === 'clear_all') {
      dispatch({ type: 'CLEAR_ALL_STRUCTURES' })
      capture('project_clear_all')
      return
    }

    if (confirmKind === 'new_project') {
      dispatch({ type: 'NEW_PROJECT' })
      clearAutosave()
      resetProjectMetadata()
      capture('project_new')
      return
    }

    if (confirmKind === 'reset_catalog') {
      clearJarCatalogCache()
      dispatch({ type: 'RESET_TO_BUILTIN_CATALOG' })
      capture('catalog_reset')
    }
  }, [confirmKind, dispatch, resetProjectMetadata])

  const confirmTitle =
    confirmKind === 'clear_all'
      ? '🗑️ Clear All'
      : confirmKind === 'new_project'
        ? '📄 New Project'
        : confirmKind === 'reset_catalog'
          ? '↩️ Reset Catalog'
          : ''

  const confirmMessage =
    confirmKind === 'clear_all'
      ? 'Are you sure you want to clear everything (structures + hull tiles)? You can undo with Ctrl/Cmd+Z.'
      : confirmKind === 'new_project'
        ? 'Are you sure you want to start a new project? This will remove all structures and hull tiles, and any unsaved changes will be lost.'
        : confirmKind === 'reset_catalog'
          ? 'Reset to built-in catalog? This will clear your uploaded JAR data.'
          : ''

  const confirmLabel =
    confirmKind === 'clear_all'
      ? 'Clear All'
      : confirmKind === 'new_project'
        ? 'Start New'
        : confirmKind === 'reset_catalog'
          ? 'Reset'
          : 'Confirm'

  // Check if user has uploaded a JAR
  const hasUserJar =
    state.catalogStatus.source === 'jar_user' || state.catalogStatus.source === 'jar_user_cache'

  const handleOpenJarDialog = useCallback(() => {
    setIsJarDialogOpen(true)
  }, [])

  const handleCloseJarDialog = useCallback(() => {
    setIsJarDialogOpen(false)
  }, [])

  return (
    <div className={styles.actionBar}>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <input
        ref={jarInputRef}
        type="file"
        accept=".jar"
        onChange={onJarInputChange}
        style={{ display: 'none' }}
      />

      <div className={styles.projectMeta}>
        <label className={styles.projectLabel} htmlFor="project-name">
          Plan:
        </label>
        <input
          id="project-name"
          className={styles.projectNameInput}
          type="text"
          value={projectMetadata.projectName}
          onChange={handleProjectNameChange}
          onBlur={handleProjectNameBlur}
          aria-label="Project name"
          title="Saved JSON files use this name plus an incrementing revision"
        />
        <span className={styles.revisionLabel} title="Last saved revision">
          v{String(projectMetadata.revision).padStart(3, '0')}
        </span>
      </div>

      <div className={styles.group}>
        <button className={styles.button} onClick={handleNewProject}>
          📄 New
        </button>
        <button className={styles.button} onClick={handleSave}>
          💾 Save
        </button>
        <button className={styles.button} onClick={handleLoadClick}>
          📂 Load
        </button>
      </div>

      <div className={styles.group}>
        <button className={styles.button} onClick={handleExportPNG}>
          🖼️ Export PNG
        </button>
      </div>

      <div className={styles.group}>
        <button
          className={styles.button}
          onClick={handleChooseExportDirectory}
          disabled={!exportDirectorySupported}
          title={
            exportDirectorySupported
              ? 'Choose a local folder for JSON and PNG exports'
              : 'Folder export is not supported by this browser; files will use Downloads'
          }
        >
          📁 {exportDirectory ? 'Change Export Folder' : 'Choose Export Folder'}
        </button>
        <span
          className={styles.projectLabel}
          title={
            exportDirectory
              ? 'Exports are written directly to this authorized folder'
              : 'Exports use the browser Downloads folder'
          }
        >
          {exportDirectory?.name ?? 'Downloads'}
        </span>
      </div>

      <div className={styles.group}>
        <button
          className={styles.button}
          onClick={handleOpenJarDialog}
          disabled={state.catalogStatus.isParsing}
          title="Upload your spacehaven.jar to update the catalog with your game version"
        >
          {state.catalogStatus.isParsing ? '⏳ Parsing...' : '📦 Import JAR'}
        </button>
        {hasUserJar && (
          <button
            className={styles.button}
            onClick={handleResetCatalog}
            title="Reset to the built-in catalog"
          >
            ↩️ Reset Catalog
          </button>
        )}
      </div>

      <JarImportDialog
        isOpen={isJarDialogOpen}
        isParsing={state.catalogStatus.isParsing}
        onClose={handleCloseJarDialog}
        onSelectFile={selectJarFile}
      />
      <ConfirmDialog
        isOpen={confirmKind !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        variant="danger"
        onClose={handleCloseConfirm}
        onConfirm={handleConfirm}
      />

      <div className={styles.group}>
        <button className={styles.buttonDanger} onClick={handleClear}>
          🗑️ Clear All
        </button>
      </div>
    </div>
  )
}
