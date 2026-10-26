export type ProtocolDetailsState = {
  params?: Record<string, any>;
  [key: string]: any;
};

type ParamUpdater = (prevParam: any) => any;

type MultiPointerUpdateOptions = {
  syncObjectToValue?: boolean;
};

function buildEmptyMultiPointerItem() {
  return {
    object: "",
    value: "",
    info: "",
  };
}

function ensureMultiPointerEditableList(editableValue: any): any[] {
  return Array.isArray(editableValue) ? [...editableValue] : [];
}

function ensureMultiPointerLength(list: any[], minLength: number) {
  while (list.length <= minLength) {
    list.push(buildEmptyMultiPointerItem());
  }
  return list;
}

export function buildPointerSelectionItem(source: any) {
  const value = String(source?.value ?? "");

  return {
    object: value,
    value,
    info: String(source?.info ?? ""),
    pointerClass: String(source?.pointerClass ?? ""),
    parentId: source?.protocolId ?? source?.parentId ?? null,
  };
}

export function updateParamState(
  prev: ProtocolDetailsState,
  stateKey: string,
  updater: ParamUpdater
): ProtocolDetailsState {
  const prevParams = prev?.params ?? {};
  const prevParam = prevParams[stateKey];

  if (!prevParam) return prev;

  const nextParam = updater(prevParam);
  if (nextParam === prevParam) return prev;

  return {
    ...prev,
    params: {
      ...prevParams,
      [stateKey]: nextParam,
    },
  };
}

export function setParamFields(
  prev: ProtocolDetailsState,
  stateKey: string,
  patch: Record<string, any>
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => ({
    ...prevParam,
    ...patch,
  }));
}

export function setParamEditableValue(
  prev: ProtocolDetailsState,
  stateKey: string,
  editableValue: any
): ProtocolDetailsState {
  return setParamFields(prev, stateKey, { editableValue });
}

export function setParamValueAndEditableValue(
  prev: ProtocolDetailsState,
  stateKey: string,
  value: any
): ProtocolDetailsState {
  return setParamFields(prev, stateKey, {
    editableValue: value,
    value,
  });
}

export function clearParamValue(
  prev: ProtocolDetailsState,
  stateKey: string
): ProtocolDetailsState {
  return setParamValueAndEditableValue(prev, stateKey, "");
}

export function setPointerSelection(
  prev: ProtocolDetailsState,
  stateKey: string,
  selected: any
): ProtocolDetailsState {
  const item = buildPointerSelectionItem(selected);

  return setParamFields(prev, stateKey, {
    editableValue: item.value,
    value: item.value,
    info: item.info,
    pointerClass: item.pointerClass,
    parentId: item.parentId,
  });
}

export function setMultiPointerItems(
  prev: ProtocolDetailsState,
  stateKey: string,
  items: any[]
): ProtocolDetailsState {
  return setParamFields(prev, stateKey, {
    editableValue: Array.isArray(items) ? items : [],
  });
}

export function setMultiPointerSelection(
  prev: ProtocolDetailsState,
  stateKey: string,
  selectedList: any[]
): ProtocolDetailsState {
  const items = (Array.isArray(selectedList) ? selectedList : []).map(buildPointerSelectionItem);
  return setMultiPointerItems(prev, stateKey, items);
}

export function updateMultiPointerItem(
  prev: ProtocolDetailsState,
  stateKey: string,
  rowIndex: number,
  patch: { object?: string; info?: string; value?: string; pointerClass?: string; parentId?: any },
  options?: MultiPointerUpdateOptions
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const list = ensureMultiPointerEditableList(prevParam?.editableValue);
    ensureMultiPointerLength(list, rowIndex);

    const current = list[rowIndex] ?? buildEmptyMultiPointerItem();
    const nextItem = { ...current, ...patch };

    if (options?.syncObjectToValue && typeof patch.object === "string") {
      nextItem.value = patch.object;
    }

    list[rowIndex] = nextItem;

    return {
      ...prevParam,
      editableValue: list,
    };
  });
}

export function replaceMultiPointerItem(
  prev: ProtocolDetailsState,
  stateKey: string,
  rowIndex: number,
  nextItem: any
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const list = ensureMultiPointerEditableList(prevParam?.editableValue);
    ensureMultiPointerLength(list, rowIndex);
    list[rowIndex] = nextItem;

    return {
      ...prevParam,
      editableValue: list,
    };
  });
}

export function removeMultiPointerItemAndPad(
  prev: ProtocolDetailsState,
  stateKey: string,
  rowIndex: number
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const list = ensureMultiPointerEditableList(prevParam?.editableValue);
    list.splice(rowIndex, 1);
    list.push({
      object: "",
      info: "",
    });

    return {
      ...prevParam,
      editableValue: list,
    };
  });
}

function ensureTableEditableRows(editableValue: any): Record<string, any>[] {
  return Array.isArray(editableValue) ? editableValue.map((row) => ({ ...row })) : [];
}

export function updateTableCell(
  prev: ProtocolDetailsState,
  stateKey: string,
  rowIndex: number,
  colName: string,
  value: any
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const rows = ensureTableEditableRows(prevParam?.editableValue);
    while (rows.length <= rowIndex) {
      rows.push({});
    }

    rows[rowIndex] = {
      ...(rows[rowIndex] ?? {}),
      [colName]: value,
    };

    return {
      ...prevParam,
      editableValue: rows,
    };
  });
}

export function addTableRow(
  prev: ProtocolDetailsState,
  stateKey: string,
  emptyRow: Record<string, any>
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const rows = ensureTableEditableRows(prevParam?.editableValue);
    rows.push({ ...emptyRow });

    return {
      ...prevParam,
      editableValue: rows,
    };
  });
}

export function removeTableRow(
  prev: ProtocolDetailsState,
  stateKey: string,
  rowIndex: number,
  emptyRow: Record<string, any>
): ProtocolDetailsState {
  return updateParamState(prev, stateKey, (prevParam) => {
    const rows = ensureTableEditableRows(prevParam?.editableValue);
    rows.splice(rowIndex, 1);
    if (rows.length === 0) {
      rows.push({ ...emptyRow });
    }

    return {
      ...prevParam,
      editableValue: rows,
    };
  });
}