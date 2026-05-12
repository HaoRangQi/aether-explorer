import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en';
import zh from './locales/zh';

// To support 3rd party language packs, we can export a register method
export const registerLanguagePack = (langCode: string, translation: any) => {
  i18n.addResourceBundle(langCode, 'translation', translation, true, true);
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh }
    },
    lng: 'zh', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
