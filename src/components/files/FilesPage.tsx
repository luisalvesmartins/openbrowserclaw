// ---------------------------------------------------------------------------
// OpenBrowserClaw — Files page
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Folder, Globe, Image, FileText, FileCode, FileJson, FileSpreadsheet,
  File, Home, Search, Download, Trash2, X, FolderOpen, Archive,
  CheckSquare, Square,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import JSZip from 'jszip';
import { DEFAULT_GROUP_ID } from '../../config.js';
import { listGroupFiles, readGroupFile, deleteGroupFile, uploadGroupFile } from '../../storage.js';
import { FileViewerModal } from './FileViewerModal.js';

interface FileEntry {
  name: string;
  isDir: boolean;
}

function getFileIcon(name: string, isDir: boolean): LucideIcon {
  if (isDir) return Folder;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, LucideIcon> = {
    html: Globe, htm: Globe, svg: Globe,
    png: Image, jpg: Image, jpeg: Image, gif: Image,
    md: FileText, txt: FileText,
    json: FileJson,
    js: FileCode, ts: FileCode, css: FileCode, xml: FileCode,
    csv: FileSpreadsheet,
  };
  return icons[ext] ?? File;
}

export function FilesPage() {
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<{ name: string; content: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const groupId = DEFAULT_GROUP_ID;
  const currentDir = path.length > 0 ? path.join('/') : '.';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await listGroupFiles(groupId, currentDir);
      const parsed: FileEntry[] = raw.map((name) => ({
        name: name.replace(/\/$/, ''),
        isDir: name.endsWith('/'),
      }));
      setEntries(parsed);
    } catch (err) {
      if ((err as Error)?.name === 'NotFoundError') {
        setEntries([]);
      } else {
        setError('Failed to load files');
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, currentDir]);

  useEffect(() => {
    loadEntries();
    setPreviewFile(null);
    setPreviewContent(null);
    setSelected(new Set());
  }, [loadEntries]);

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      for (const f of Array.from(files)) {
        const filePath = path.length > 0 ? `${path.join('/')}/${f.name}` : f.name;
        await uploadGroupFile(groupId, filePath, f);
      }
      await loadEntries();
    } catch (err) {
      setError('Failed to upload file(s)');
    } finally {
      setLoading(false);
      // reset input so same file can be re-selected later
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handlePreview(name: string) {
    setPreviewFile(name);
    try {
      const filePath = path.length > 0 ? `${path.join('/')}/${name}` : name;
      const content = await readGroupFile(groupId, filePath);
      setPreviewContent(content);
    } catch {
      setPreviewContent('[Unable to read file]');
    }
  }

  /** Delete a single file (used from the preview pane). */
  async function handleDelete(name: string) {
    try {
      const filePath = path.length > 0 ? `${path.join('/')}/${name}` : name;
      await deleteGroupFile(groupId, filePath);
      setDeleteConfirm(null);
      setPreviewFile(null);
      setPreviewContent(null);
      loadEntries();
    } catch {
      setError('Failed to delete file');
    }
  }

  /** Recursively delete all files inside a directory, then the directory itself. */
  async function deleteRecursive(dirPath: string) {
    try {
      const raw = await listGroupFiles(groupId, dirPath);
      for (const entry of raw) {
        const isDir = entry.endsWith('/');
        const cleanName = entry.replace(/\/$/, '');
        const fullPath = dirPath === '.' ? cleanName : `${dirPath}/${cleanName}`;

        if (isDir) {
          await deleteRecursive(fullPath);
        } else {
          await deleteGroupFile(groupId, fullPath);
        }
      }
      // Try deleting the directory entry itself (some storage backends need this)
      try {
        await deleteGroupFile(groupId, dirPath);
      } catch {
        // ignore — directory may have been implicitly removed
      }
    } catch {
      // If we can't list it, try deleting it as a file
      try {
        await deleteGroupFile(groupId, dirPath);
      } catch {
        // skip
      }
    }
  }

  /** Bulk-delete all selected files and folders. */
  async function handleBulkDelete() {
    setDeleting(true);
    setError(null);
    try {
      for (const name of selected) {
        const entry = entries.find((e) => e.name === name);
        const fullPath = path.length > 0 ? `${path.join('/')}/${name}` : name;

        if (entry?.isDir) {
          await deleteRecursive(fullPath);
        } else {
          await deleteGroupFile(groupId, fullPath);
        }
      }
      // Clean up state
      setBulkDeleteConfirm(false);
      setSelected(new Set());
      setPreviewFile(null);
      setPreviewContent(null);
      await loadEntries();
    } catch (err) {
      setError('Failed to delete some files');
      console.error(err);
      // Still reload to reflect partial progress
      await loadEntries();
    } finally {
      setDeleting(false);
    }
  }

  function handleOpenViewer(name: string, content: string) {
    setViewerFile({ name, content });
  }

  function handleDownload(name: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Selection helpers ----

  function toggleSelection(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === entries.length && entries.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.name)));
    }
  }

  // ---- ZIP download ----

  /** Recursively collect all files under a given directory path. */
  async function collectFilesRecursive(
    dirPath: string,
    zip: JSZip,
    zipPrefix: string,
  ) {
    const raw = await listGroupFiles(groupId, dirPath);
    for (const entry of raw) {
      const isDir = entry.endsWith('/');
      const cleanName = entry.replace(/\/$/, '');
      const fullPath = dirPath === '.' ? cleanName : `${dirPath}/${cleanName}`;
      const zipPath = zipPrefix ? `${zipPrefix}/${cleanName}` : cleanName;

      if (isDir) {
        await collectFilesRecursive(fullPath, zip, zipPath);
      } else {
        try {
          const content = await readGroupFile(groupId, fullPath);
          zip.file(zipPath, content);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  async function handleDownloadZip() {
    setZipping(true);
    setError(null);
    try {
      const zip = new JSZip();

      // Determine which files to include
      const filesToZip = selected.size > 0
        ? entries.filter((e) => selected.has(e.name))
        : entries; // all entries in current dir if nothing selected

      for (const entry of filesToZip) {
        const fullPath = path.length > 0
          ? `${path.join('/')}/${entry.name}`
          : entry.name;

        if (entry.isDir) {
          // Recursively add directory contents
          await collectFilesRecursive(fullPath, zip, entry.name);
        } else {
          try {
            const content = await readGroupFile(groupId, fullPath);
            zip.file(entry.name, content);
          } catch {
            // skip unreadable files
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipName = path.length > 0
        ? `${path[path.length - 1]}.zip`
        : 'workspace.zip';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to create ZIP file');
      console.error(err);
    } finally {
      setZipping(false);
    }
  }

  // Derived state
  const allSelected = entries.length > 0 && selected.size === entries.length;
  const selectedDirCount = [...selected].filter((name) => entries.find((e) => e.name === name)?.isDir).length;
  const selectedFileCount = selected.size - selectedDirCount;

  // Build a human-readable description of the selection for the delete modal
  function selectionSummary(): string {
    const parts: string[] = [];
    if (selectedFileCount > 0) {
      parts.push(`${selectedFileCount} file${selectedFileCount > 1 ? 's' : ''}`);
    }
    if (selectedDirCount > 0) {
      parts.push(`${selectedDirCount} folder${selectedDirCount > 1 ? 's' : ''} (and all contents)`);
    }
    return parts.join(' and ');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumbs */}
      <div className="px-4 py-2 bg-base-200 border-b border-base-300">
        <div className="flex items-center justify-between">
          <div className="breadcrumbs text-sm">
            <ul>
              <li>
                <button
                  className="link link-hover flex items-center gap-1"
                  onClick={() => setPath([])}
                >
                  <Home className="w-4 h-4" /> workspace
                </button>
              </li>
              {path.map((segment, i) => (
                <li key={i}>
                  <button
                    className="link link-hover"
                    onClick={() => setPath(path.slice(0, i + 1))}
                  >
                    {segment}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            <button
              className="btn btn-sm"
              onClick={() => fileInputRef.current?.click()}
              title="Upload local files to workspace"
            >
              Upload
            </button>
            {entries.length > 0 && (
              <button
                className="btn btn-sm gap-1"
                onClick={handleDownloadZip}
                disabled={zipping}
                title={
                  selected.size > 0
                    ? `Download ${selected.size} selected item(s) as ZIP`
                    : 'Download all files as ZIP'
                }
              >
                {zipping ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                {selected.size > 0 ? `ZIP (${selected.size})` : 'ZIP'}
              </button>
            )}
            {selected.size > 0 && (
              <button
                className="btn btn-sm btn-error gap-1"
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={deleting}
                title={`Delete ${selected.size} selected item(s)`}
              >
                {deleting ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete ({selected.size})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : error ? (
            <div role="alert" className="alert alert-error m-4">{error}</div>
          ) : entries.length === 0 ? (
            <div className="hero py-12">
              <div className="hero-content text-center">
                <div>
                  <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No files yet</p>
                  <p className="text-sm opacity-60 mt-1">Files created by the assistant will appear here</p>
                </div>
              </div>
            </div>
          ) : (
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="w-8 text-center">
                    <button
                      className="btn btn-ghost btn-xs p-0"
                      onClick={toggleSelectAll}
                      title={allSelected ? 'Deselect all' : 'Select all'}
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 opacity-40" />
                      )}
                    </button>
                  </th>
                  <th className="w-8" />
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.name}
                    className={`hover cursor-pointer ${
                      previewFile === entry.name ? 'active' : ''
                    } ${selected.has(entry.name) ? 'bg-base-200' : ''}`}
                    onClick={() =>
                      entry.isDir
                        ? setPath([...path, entry.name])
                        : handlePreview(entry.name)
                    }
                  >
                    <td className="w-8 text-center">
                      <button
                        className="btn btn-ghost btn-xs p-0"
                        onClick={(e) => toggleSelection(entry.name, e)}
                        title={selected.has(entry.name) ? 'Deselect' : 'Select'}
                      >
                        {selected.has(entry.name) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 opacity-40" />
                        )}
                      </button>
                    </td>
                    <td className="w-8 text-center">
                      {(() => { const Icon = getFileIcon(entry.name, entry.isDir); return <Icon className="w-4 h-4 inline-block" />; })()}
                    </td>
                    <td className="font-medium">
                      {entry.name}
                      {entry.isDir && (
                        <span className="opacity-30 ml-1">/</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Preview pane (hidden on mobile, shown as modal instead) */}
        {previewFile && previewContent !== null && (
          <div className="hidden md:flex flex-col w-1/2 border-l border-base-300 bg-base-200">
            <div className="flex items-center justify-between px-4 py-2 border-b border-base-300">
              <span className="font-medium text-sm truncate flex items-center gap-1.5">
                {(() => { const Icon = getFileIcon(previewFile, false); return <Icon className="w-4 h-4" />; })()}
                {previewFile}
              </span>
              <div className="flex gap-1">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleOpenViewer(previewFile, previewContent)}
                  title="Open in viewer"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleDownload(previewFile, previewContent)}
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => setDeleteConfirm(previewFile)}
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {isRenderable(previewFile) ? (
                <iframe
                  srcDoc={previewContent}
                  className="w-full h-full border-0 rounded bg-white"
                  sandbox="allow-scripts"
                  title="File preview"
                />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                  {previewContent}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile: preview shows as a bottom sheet / full modal */}
      {previewFile && previewContent !== null && (
        <div className="md:hidden fixed inset-0 z-50 bg-base-100 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
            <span className="font-medium truncate flex items-center gap-1.5">
              {(() => { const Icon = getFileIcon(previewFile, false); return <Icon className="w-4 h-4" />; })()}
              {previewFile}
            </span>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleOpenViewer(previewFile, previewContent)}
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleDownload(previewFile, previewContent)}
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm text-error"
                onClick={() => setDeleteConfirm(previewFile)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPreviewFile(null);
                  setPreviewContent(null);
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {isRenderable(previewFile) ? (
              <iframe
                srcDoc={previewContent}
                className="w-full h-full border-0 rounded bg-white"
                sandbox="allow-scripts"
                title="File preview"
              />
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {previewContent}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Single-file delete confirmation */}
      {deleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">Delete file?</h3>
            <p className="py-4">
              Are you sure you want to delete <strong>{deleteConfirm}</strong>? This cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-error"
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setDeleteConfirm(null)}>close</button>
          </form>
        </dialog>
      )}

      {/* Bulk delete confirmation */}
      {bulkDeleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">Delete {selected.size} item{selected.size > 1 ? 's' : ''}?</h3>
            <p className="py-4">
              Are you sure you want to delete {selectionSummary()}? This cannot be undone.
            </p>
            {selectedDirCount > 0 && (
              <div role="alert" className="alert alert-warning text-sm mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span>Folder deletion is recursive — all nested files and subfolders will be removed.</span>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto text-sm opacity-70 mb-2">
              <ul className="list-disc list-inside">
                {[...selected].sort().map((name) => {
                  const entry = entries.find((e) => e.name === name);
                  return (
                    <li key={name}>
                      {name}{entry?.isDir ? '/' : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setBulkDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-error gap-1"
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {deleting && <span className="loading loading-spinner loading-xs" />}
                Delete {selected.size} item{selected.size > 1 ? 's' : ''}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setBulkDeleteConfirm(false)} disabled={deleting}>close</button>
          </form>
        </dialog>
      )}

      {/* File viewer modal */}
      {viewerFile && (
        <FileViewerModal
          name={viewerFile.name}
          content={viewerFile.content}
          onClose={() => setViewerFile(null)}
        />
      )}
    </div>
  );
}

function isRenderable(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ['html', 'htm', 'svg'].includes(ext);
}
