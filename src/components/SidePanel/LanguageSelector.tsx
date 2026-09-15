import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../i18n';

export default function LanguageSelector() {
  const { t, i18n } = useTranslation();

  return (
    <div className="language-selector">
      <Languages />
      <select
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(event) => i18n.changeLanguage(event.target.value as SupportedLanguage)}
        aria-label={t('language.label')}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
