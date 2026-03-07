import { useState, useCallback } from "react";

export interface EntityModalState<T> {
  addModal: boolean;
  openAdd: () => void;
  closeAdd: () => void;
  editModal: T | null;
  openEdit: (entity: T) => void;
  closeEdit: () => void;
  deleteModal: T | null;
  openDelete: (entity: T) => void;
  closeDelete: () => void;
  detailsModal: T | null;
  openDetails: (entity: T) => void;
  closeDetails: () => void;
}

export function useEntityModals<T>(): EntityModalState<T> {
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState<T | null>(null);
  const [deleteModal, setDeleteModal] = useState<T | null>(null);
  const [detailsModal, setDetailsModal] = useState<T | null>(null);

  const openAdd = useCallback(() => setAddModal(true), []);
  const closeAdd = useCallback(() => setAddModal(false), []);
  const openEdit = useCallback((entity: T) => setEditModal(entity), []);
  const closeEdit = useCallback(() => setEditModal(null), []);
  const openDelete = useCallback((entity: T) => setDeleteModal(entity), []);
  const closeDelete = useCallback(() => setDeleteModal(null), []);
  const openDetails = useCallback((entity: T) => setDetailsModal(entity), []);
  const closeDetails = useCallback(() => setDetailsModal(null), []);

  return {
    addModal,
    openAdd,
    closeAdd,
    editModal,
    openEdit,
    closeEdit,
    deleteModal,
    openDelete,
    closeDelete,
    detailsModal,
    openDetails,
    closeDetails,
  };
}
