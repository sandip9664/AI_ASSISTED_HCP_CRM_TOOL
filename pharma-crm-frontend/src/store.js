import { configureStore, createSlice } from '@reduxjs/toolkit';

const initialFormState = {
  hcpName: '',
  interactionType: 'Meeting',
  date: '2025-04-19', 
  time: '19:36',       
  attendees: '',
  topicsDiscussed: '',
  materialsShared: [],
  samplesDistributed: [],
  sentiment: 'Neutral',
  outcomes: '',
  followUpActions: '',
  aiSuggestedFollowups: [
    'Schedule follow-up meeting in 2 weeks',
    'Send Clinical Trial Phase III PDF'
  ]
};

const crmFormSlice = createSlice({
  name: 'crmForm',
  initialState: initialFormState,
  reducers: {
    updateField: (state, action) => {
      const { field, value } = action.payload;
      state[field] = value;
    },
    syncEntireForm: (state, action) => {
      return { ...state, ...action.payload };
    },
    resetForm: () => initialFormState
  }
});

export const { updateField, syncEntireForm, resetForm } = crmFormSlice.actions;
export const store = configureStore({ reducer: { crm: crmFormSlice.reducer } });