import { useReducer } from "react";

const useTagEditor = (tagSchema) => {
  const [tagState, dispatchTagState] = useReducer(
    (prevState, action) => {
      switch (action.type) {
        case "reset":
          return { color: null, textComponent: [] };
        case "setColor":
          return { ...prevState, color: action.color };
        case "replaceComponent":
          const newComponent = {
            ...(prevState.textComponent[action.index] ?? {}),
            ...action.value,
          };
          return {
            ...prevState,
            textComponent: [
              ...prevState.textComponent.slice(0, action.index),
              newComponent,
              ...prevState.textComponent.slice(action.index + 1),
            ],
          };
        case "addDigit":
          const addedDigitComponent = {
            type: "digits",
            value:
              (prevState.textComponent[action.index]?.value || "") +
              action.digit,
            valid: false,
          };
          return {
            ...prevState,
            textComponent: [
              ...prevState.textComponent.slice(0, action.index),
              addedDigitComponent,
              ...prevState.textComponent.slice(action.index + 1),
            ],
          };
        case "removeDigit":
          const removedDigitComponent = {
            type: "digits",
            value: (prevState.textComponent[action.index]?.value || "").slice(
              0,
              -1
            ),
            valid: false,
          };
          return {
            ...prevState,
            textComponent: [
              ...prevState.textComponent.slice(0, action.index),
              removedDigitComponent,
              ...prevState.textComponent.slice(action.index + 1),
            ],
          };
        case "setDigitsValid":
          const setDigitsValidComponent = {
            type: "digits",
            value: prevState.textComponent[action.index]?.value,
            valid: true,
          };
          return {
            ...prevState,
            textComponent: [
              ...prevState.textComponent.slice(0, action.index),
              setDigitsValidComponent,
              ...prevState.textComponent.slice(action.index + 1),
            ],
          };
      }
      return {
        ...prevState,
        ...action,
      };
    },
    { color: null, textComponent: [] }
  );

  const tag = tagState.textComponent.map((tc) => tc.value).join("");
  const needsColor = tagSchema?.colors && !tagState.color;
  const nextTagStepIndex = tagState.textComponent.filter(
    (tc) => tc.valid
  ).length;
  const tagCompleted = nextTagStepIndex === tagSchema?.textSchema.length;

  const setColor = (color) => {
    dispatchTagState({ type: "setColor", color });
  };

  const replaceTagComponent = (index, value) => {
    dispatchTagState({ type: "replaceComponent", index, value });
  };

  const addDigitToTagComponent = (index, digit) => {
    dispatchTagState({ type: "addDigit", index, digit });
  };
  const removeDigitFromTagComponent = (index) => {
    dispatchTagState({ type: "removeDigit", index });
  };
  const setDigitsValid = (index) => {
    dispatchTagState({ type: "setDigitsValid", index });
  };
  const resetTag = () => {
    dispatchTagState({ type: "reset" });
  };

  return {
    color: tagState.color,
    setColor,
    replaceTagComponent,
    addDigitToTagComponent,
    removeDigitFromTagComponent,
    setDigitsValid,
    resetTag,
    tag,
    needsColor,
    nextTagStepIndex,
    tagCompleted,
  };
};

export default useTagEditor;
