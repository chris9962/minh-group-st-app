import { can } from '@/lib/permissions';
import { canOrg } from '@/lib/permissions';
import type { DocArticle } from '../types';

/** Số liệu, xuất dữ liệu và tra cứu. */
export const DATA_DOCS: DocArticle[] = [
  {
    slug: 'man-tong-quan',
    title: 'Màn Tổng quan',
    screen: 'P-80',
    group: 'data',
    summary: 'Xem điểm KPI và số liệu của bạn hoặc của phòng, tuỳ chức vụ.',
    keywords: [
      'tổng quan',
      'dashboard',
      'điểm của tôi',
      'điểm KPI',
      'còn thiếu bao nhiêu điểm',
      'xếp hạng',
      'số liệu phòng',
      'không thấy số của phòng',
    ],
    visibleTo: (user) =>
      can(user, 'insurance', 'view-summary') ||
      can(user, 'banking', 'view-summary') ||
      can(user, 'services', 'view-summary'),
    blocks: [
      {
        kind: 'text',
        body: 'Màn Tổng quan là trang đầu tiên sau khi bạn đăng nhập. Nội dung đổi theo chức vụ của bạn.',
      },
      {
        kind: 'text',
        body: 'Nhân viên thấy số liệu của chính mình: số tài khoản mở, số đơn bảo hiểm, số lượt dịch vụ, điểm tháng và chỉ tiêu. Khối điểm ghi rõ bạn còn thiếu bao nhiêu điểm hoặc đã vượt bao nhiêu.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Màn này đọc chức vụ, không đọc quyền. Giám đốc thấy toàn công ty. Phó giám đốc thấy các phòng mình quản. Trưởng phòng và Phó phòng thấy phòng mình. Nhân viên thấy số của chính mình.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/dashboard-page.png',
          alt: 'Màn Tổng quan với bộ chọn kỳ và các thẻ số liệu',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 12.1, label: 'Mục Tổng quan trên thanh điều hướng.' },
            { n: 2, x: 86, y: 4.2, label: 'Bộ chọn kỳ — đổi khoảng thời gian của số liệu.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Tổng quan** trên thanh điều hướng.',
          'Chọn khoảng thời gian ở bộ chọn kỳ góc trên bên phải.',
          'Trên điện thoại, bạn bấm nút **Bộ lọc** để mở bộ chọn kỳ.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn thấy số liệu hẹp hơn đồng nghiệp cùng phòng thì đó là do chức vụ, không phải do quyền. Bạn hỏi quản trị nếu chức vụ ghi sai.',
      },
    ],
  },
  {
    slug: 'xuat-du-lieu',
    title: 'Xuất dữ liệu ra Excel',
    screen: 'P-73',
    group: 'data',
    summary: 'Tải báo cáo Excel của bảo hiểm, ngân hàng và dịch vụ.',
    keywords: [
      'xuất excel',
      'xuất dữ liệu',
      'báo cáo',
      'tải file',
      'download',
      'tải excel về máy',
      'file lưu ở đâu',
      'xuất danh sách khách',
      'chọn cột',
    ],
    visibleTo: (user) =>
      can(user, 'insurance', 'export') ||
      can(user, 'banking', 'export') ||
      can(user, 'services', 'export'),
    blocks: [
      {
        kind: 'text',
        body: 'Màn này xuất báo cáo ra file Excel. Bạn chọn báo cáo, chọn bộ lọc, tick các cột cần lấy rồi tải về.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/exports-page.png',
          alt: 'Màn Xuất dữ liệu với hàng tab báo cáo và nút Xuất Excel',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 54, label: 'Mục Xuất dữ liệu trên thanh điều hướng.' },
            { n: 2, x: 59.2, y: 13.8, label: 'Hàng tab báo cáo.' },
            { n: 3, x: 27, y: 72.6, label: 'Nút Xuất Excel.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Xuất dữ liệu** trên thanh điều hướng.',
          'Chọn báo cáo ở hàng tab trên cùng.',
          'Chọn bộ lọc: khoảng thời gian, ngân hàng, mã giới thiệu.',
          'Tick chọn cột cần lấy ở hàng tiêu đề của bảng xem trước.',
          'Bấm **Xuất Excel**.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Hàng tab hiện đủ mọi báo cáo. Báo cáo bạn không có quyền xuất mang biểu tượng ổ khoá và bấm không được.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Tên khách trong file xuất viết hoa và bỏ dấu theo yêu cầu của ngân hàng. Hệ thống để cột số điện thoại và CCCD ở dạng chữ. Số 0 đầu vì vậy không mất.',
      },
    ],
  },
  {
    slug: 'phong-ban',
    title: 'Phòng ban',
    screen: 'P-91',
    group: 'data',
    summary: 'Xem sơ đồ tổ chức và số liệu từng phòng. Thêm hoặc sửa phòng.',
    keywords: [
      'phòng ban',
      'cơ cấu tổ chức',
      'sơ đồ tổ chức',
      'thêm phòng',
      'ngừng phòng',
      'đơn vị',
      'số liệu phòng',
    ],
    visibleTo: (user) => canOrg(user, 'view-detail'),
    blocks: [
      {
        kind: 'text',
        body: 'Màn này liệt kê các phòng của công ty kèm số liệu nghiệp vụ của từng phòng. Ba thẻ trên cùng đếm tổng số phòng và số phòng đang hoạt động.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/departments-page.png',
          alt: 'Màn Phòng ban',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 48, label: 'Mục Phòng ban trên thanh điều hướng.' },
            { n: 2, x: 91.2, y: 4.2, label: 'Nút Thêm phòng ban.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Phòng ban** trên thanh điều hướng.',
          'Bấm vào tên phòng để xem chi tiết phòng đó.',
          'Bấm **Thêm phòng ban** để lập phòng mới.',
          'Sửa một phòng: bạn bấm nút hình bút chì ở cột **Thao tác**.',
          'Ngừng một phòng: bạn bấm nút tương ứng rồi xác nhận.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn chỉ có quyền xem thì màn này không có nút thêm và nút sửa. Phó giám đốc chỉ thấy các phòng mình quản.',
      },
    ],
  },
  {
    slug: 'nhat-ky-truy-vet',
    title: 'Nhật ký truy vết',
    screen: 'P-93',
    group: 'data',
    summary: 'Tra ai đã sửa hoặc xoá dữ liệu, và sửa lúc nào.',
    keywords: [
      'nhật ký',
      'truy vết',
      'audit',
      'lịch sử thao tác',
      'ai sửa',
      'ai xoá dữ liệu',
      'ai tạo',
      'kiểm tra thao tác',
    ],
    visibleTo: (user) => can(user, 'system', 'manage-org'),
    blocks: [
      {
        kind: 'text',
        body: 'Hệ thống ghi lại các thao tác đổi dữ liệu: ai làm, làm gì, lúc nào. Dữ liệu đổi bất thường thì bạn tra ở đây trước. Bạn hỏi từng người sau.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/audit-log-page.png',
          alt: 'Màn Nhật ký truy vết với hộp Bộ lọc đang mở',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 60, label: 'Mục Nhật ký truy vết trên thanh điều hướng.' },
            { n: 2, x: 80.1, y: 11.8, label: 'Lọc theo người thao tác.' },
            { n: 3, x: 82.1, y: 18.3, label: 'Lọc theo loại hành động.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Nhật ký truy vết** trên thanh điều hướng.',
          'Bấm **Bộ lọc** ở góc trên bên phải.',
          'Chọn **Người** để lọc theo người thao tác.',
          'Chọn **Hành động** để lọc theo loại thao tác.',
          'Chọn khoảng ngày nếu cần.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Nhật ký chỉ ghi thao tác đổi dữ liệu. Hệ thống không ghi lượt đăng nhập và đăng xuất.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Nhật ký hiện thao tác của cả công ty, không lọc theo phòng. Vì vậy bạn chỉ cấp quyền này cho người quản trị.',
      },
    ],
  },
];
