# Recon map: Аспро.Cloud (web)

Scope: модульная CRM/ERP для малого и среднего бизнеса. Все модули, кроме «Чата с ИИ» (отложен).
For: собственная CRM компании пользователя с обменом данными с 1С.
Date: 2026-10-22

## Правовая рамка

Лицензионный договор «Аспро.Клауд» (п. 4.4.1, 4.4.4, 8.2, 9.3) запрещает декомпиляцию,
производные работы и использование программы для получения исходного кода или структуры
базы данных с целью создания похожей программы. Поэтому:

- аккаунт пользователя открыт один раз (рабочий стол и публичный каталог модулей), дальше не изучался;
- сетевые запросы, JS-бандлы и структура БД оригинала не читались;
- модель данных ниже выведена из общей практики CRM/ERP-систем, а не из оригинала;
- название, логотип, палитра, иконки и тексты — свои.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Лицензионный договор (EULA) | https://aspro.cloud/about/eula/ , копия https://asproagile.ru/about/agreement/ | ограничения, см. выше |
| 2 | Каталог модулей (маркетплейс внутри продукта, 62 приложения) | раздел «Приложения» | названия и одна строка описания каждого модуля |
| 3 | App Store | https://apps.apple.com/app/id1592498390 | мобильное приложение, состав модулей |
| 4 | Обзор Workspace | https://workspace.ru/tools/crm/aspro-cloud/ | позиционирование: облачная CRM/ERP для среднего бизнеса |
| 5 | Каталог a2is | https://a2is.ru/catalog/crm-sistemy-vse/compare/suite-crm/aspro-cloud | список функций: CRM, финансы, складской учёт, Гант |
| 6 | Unisender | https://www.unisender.com/ru/support/integration/integracziya-aspro-cloud-s-unisender/ | пример механики синхронизации контрагентов |
| 7 | Протоколы 1С (публичные стандарты) | CommerceML 2, OData standard.odata, 1CClientBankExchange | основа модуля интеграции с 1С |

## Core loop

Менеджер ведёт сделку по воронке, ставит задачи, выставляет счёт, получает оплату — и видит
деньги и рентабельность в финансах. Руководитель видит всё это на рабочем столе.

## Модули (по публичному каталогу)

Ядро: Рабочий стол, Задачи, CRM, Проекты, Финансы, Команда, База знаний, Календарь, Мессенджер.
Дополнительно: Файлы, Каталог, Списки, Тайм-трекер, Почта, Коммуникации, Структура компании,
Бизнес-процессы, Автозагрузка выписки, CSV-импорт, Документы, Акты, Группы, IP-телефония,
Agile-проекты, Кабинет клиента, Отсутствия, Зарплата, Замечания по проектам, Онбординг,
Кабинет партнёра, Веб-формы, Заметки, Бюджетирование, Подотчёт, Кредиты и займы,
Обязательства, Имущество. Сторонние: Telegram, Zoom, Unisender, банки и т. п.

## Screens

| ID | screen | route | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Вход | /login | аутентификация | форма | error |
| S02 | Рабочий стол | / | сводка: задачи, продажи, финансы, счета | вкладки, виджеты, графики | empty, filled |
| S03 | Задачи: список | /tasks | мои и общие задачи | таблица, фильтры, вкладки ролей | empty, filled |
| S04 | Задачи: канбан | /tasks?view=kanban | статусы задач | канбан, drag-n-drop | filled |
| S05 | Карточка задачи | /tasks/:id | работа над задачей | поля, чек-лист, подзадачи, таймер, комментарии | filled |
| S06 | Сделки: канбан | /crm/deals | воронка продаж | канбан по стадиям, суммы | empty, filled |
| S07 | Сделки: список | /crm/deals?view=list | таблица сделок | таблица, фильтры | filled |
| S08 | Карточка сделки | /crm/deals/:id | ведение сделки | прогресс стадий, поля, товары, лента, задачи, счета | filled |
| S09 | Компании | /crm/companies | база контрагентов | таблица, поиск | empty, filled |
| S10 | Карточка компании | /crm/companies/:id | вся история клиента | реквизиты, контакты, сделки, счета, лента | filled |
| S11 | Контакты | /crm/contacts | люди | таблица | filled |
| S12 | Карточка контакта | /crm/contacts/:id | | поля, лента | filled |
| S13 | Счета на оплату | /crm/invoices | выставление и контроль оплат | таблица, статусы | filled |
| S14 | Карточка счёта | /crm/invoices/:id | позиции, оплата, печать, акт | позиции, печатная форма | filled |
| S15 | Акты | /crm/acts | закрывающие документы | таблица | filled |
| S16 | Веб-формы | /crm/forms | сбор заявок с сайта | конструктор полей, ссылка | empty, filled |
| S17 | Публичная веб-форма | /f/:id | заявка от клиента | форма | success, error |
| S18 | Проекты | /projects | портфель проектов | карточки/таблица, прогресс | empty, filled |
| S19 | Проект | /projects/:id | работа над проектом | обзор, задачи, Гант, вехи, спринты, замечания, команда, финансы, время | filled |
| S20 | Финансы: обзор | /finance | остатки, движение денег | плитки, график | filled |
| S21 | Операции | /finance/operations | приходы, расходы, переводы | таблица, фильтры | filled |
| S22 | Счета и кассы | /finance/accounts | остатки по счетам | таблица | filled |
| S23 | Платёжный календарь | /finance/calendar | плановые платежи | календарь/таблица | filled |
| S24 | Отчёты (ДДС, ОПиУ) | /finance/reports | управленческая отчётность | сводные таблицы | filled |
| S25 | Бюджеты | /finance/budgets | план/факт | матрица месяцев | filled |
| S26 | Подотчёт, займы, обязательства, имущество, зарплата | /finance/* | учёт | таблицы | filled |
| S27 | Импорт выписки | /finance/import | загрузка выписки 1С/банка | загрузка файла, предпросмотр | filled |
| S28 | Команда | /team | сотрудники | таблица/карточки | filled |
| S29 | Структура компании | /team/structure | отделы | дерево | filled |
| S30 | Отсутствия | /team/absences | отпуска, больничные | диаграмма по дням | filled |
| S31 | База знаний | /kb | статьи | дерево разделов, редактор | empty, filled |
| S32 | Календарь | /calendar | события | месяц/неделя | filled |
| S33 | Мессенджер | /messenger | чаты команды | список чатов, сообщения | filled |
| S34 | Коммуникации | /communications | диалоги с клиентами | входящие, диалог, привязка к CRM | filled |
| S35 | Почта | /mail | письма | папки, письмо, ответ | filled |
| S36 | Файлы | /files | хранилище | папки, загрузка | empty, filled |
| S37 | Каталог | /catalog | товары и услуги | категории, таблица, остатки | filled |
| S38 | Списки | /lists | свои справочники | конструктор полей, таблица | empty, filled |
| S39 | Тайм-трекер | /time | учёт времени | таймер, табель | filled |
| S40 | Бизнес-процессы | /bp | согласования, автоматизация | шаблоны, шаги, экземпляры | filled |
| S41 | Документы | /documents | шаблоны и печатные формы | редактор шаблона | filled |
| S42 | Заметки | /notes | личные заметки | карточки | empty, filled |
| S43 | Настройки | /settings/* | компания, роли, воронки, поля, 1С, API | формы | filled |
| S44 | Интеграция с 1С | /settings/onec | обмен с 1С | настройки, журнал | filled |
| S45 | Глобальный поиск, быстрое создание, уведомления | шапка | навигация | поповеры | empty, filled |

## Flows

```
F01 Заявка с сайта превращается в оплаченную сделку
    S17 форма -> S06 новая сделка -> S08 карточка -> товары -> S14 счёт -> оплата -> стадия «Успешно»
    happy path clicks: ~9
    edge: дубль компании по ИНН, частичная оплата, просрочка счёта
F02 Менеджер ставит и закрывает задачу
    S03 -> «+ Задача» -> S05 -> чек-лист -> «Завершить»
    happy path clicks: 4
    edge: просроченная задача, задача без исполнителя, повторяющаяся задача
F03 Руководитель смотрит финансовый результат
    S02 -> S24 ОПиУ за месяц -> детализация по статье
F04 Проект из сделки
    S08 -> «Создать проект» -> S19 -> задачи -> Гант
F05 Обмен с 1С
    S44 -> адрес базы, логин -> «Проверить» -> «Синхронизировать» -> журнал
    или 1С сама ходит в /api/1c/exchange по протоколу CommerceML
F06 Загрузка выписки
    S27 -> файл kl_to_1c.txt -> предпросмотр -> разнесение по статьям -> S21
F07 Согласование
    S40 -> запуск процесса -> задача согласующему -> «Согласовать»/«Отклонить» -> уведомление
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger, icon | default, hover, focus, disabled, loading | все |
| Input / Select / DatePicker / RefSelect | text, number, money, date, user, entity | default, focus, error, disabled | формы |
| DataTable | сортировка, выбор строк, ссылки | empty, loading, filled | списки |
| Kanban | сделки, задачи | drag, empty column | S04, S06 |
| Drawer / Modal | форма, подтверждение | open, closed | все |
| Timeline | комментарий, системное событие, звонок | empty, filled | карточки |
| StageProgress | стадии воронки | open, won, lost | S08 |
| Tabs, Badge, Avatar, Toast, EmptyState, Stat tile | | | все |
| Sidebar, Topbar, Search popover, Notifications | | | layout |

## Inferred data model (из общей практики CRM, не из оригинала)

```
User         id, name, email, role, department, position, phone           confidence: high
Company      name, inn, kpp, type, industry, phone, email, address, responsible, onec_guid   high
Contact      fio, company, position, phone, email, birthday               high
Pipeline/Stage  name, color, kind(open|won|lost), sort                    high
Deal         title, pipeline, stage, amount, company, contact, responsible, close date, products  high
Activity     entity_type, entity_id, kind(comment|call|meeting|system), text   high
Task         title, status, priority, assignee, author, deadline, project, parent, deal, checklist   high
Project      name, status, manager, dates, budget, members, milestones, sprints, issues   high
TimeEntry    user, task, project, minutes                                 high
FinAccount / FinCategory / FinOperation / Invoice(+items) / Act / Budget / Loan / Obligation / Asset / Payroll   medium
KbSection / KbArticle, File / Folder, Event, Chat / Message, Conversation / Channel, Mail   medium
CustomList, BpTemplate / BpInstance, WebForm, DocTemplate, Note, Notification   medium
```

Relationships: Company 1-n Contact, Company 1-n Deal, Deal 1-n Task, Deal 1-n Invoice,
Invoice 1-n Payment(FinOperation), Project 1-n Task, Task 1-n TimeEntry.

## Feature matrix

См. `features.csv`.

## Out of scope

- Чат с ИИ — отложен по решению пользователя.
- IP-телефония, Zoom, Unisender, банки по API, мессенджеры по API — нужны договоры и ключи
  провайдеров. В CRM есть точки подключения (каналы, вебхуки), сами интеграции — следующим этапом.
- Мобильные приложения — веб-версия адаптивная.
- Кабинет партнёра — партнёрская программа самого Аспро.

## Size

Screens 45, flows 7, entities ~45. Hard parts: обмен с 1С, финансовая отчётность,
бизнес-процессы, Гант, работа без сервера в демо-режиме. Size: XL — урезано до
«широко, но неглубоко»: все модули с рабочим CRUD и ключевыми сценариями, глубокие
интеграции — следующим этапом.
