import { typesetTree } from './typography';

export const homeRowsRu = typesetTree({
  continue: {
    eyebrow: 'Последняя игра · {when}, {duration}',
    serverPage: 'Страница сервера',
    ready: 'Версия {version} установлена, вход сразу на сервер',
    install: 'Версия {version} скачается при первом запуске',
    ownLauncher: 'У сервера свой лаунчер',
    address: 'Адрес для входа: ',
    offline: 'Сервер сейчас не отвечает',
  },
  topSlot: {
    more: 'Подробнее',
    moreAbout: 'Подробнее о сервере {name}',
  },
});
