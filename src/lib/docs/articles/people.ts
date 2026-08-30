import { can } from '@/lib/permissions';
import type { DocArticle } from '../types';

/** Nhân sự và phân quyền. */
export const PEOPLE_DOCS: DocArticle[] = [
  {
    slug: 'doi-mat-khau',
    title: 'Đổi mật khẩu của bạn',
    screen: 'P-94',
    group: 'people',
    summary: 'Tự đổi mật khẩu ở màn Thông tin cá nhân. Quên thì nhờ quản lý đặt lại.',
    keywords: [
      'đổi mật khẩu',
      'quên mật khẩu',
      'mật khẩu',
      'không đăng nhập được',
      'mật khẩu mới',
      'thông tin cá nhân',
    ],
    visibleTo: () => true,
    blocks: [
      {
        kind: 'text',
        body: 'Bạn tự đổi mật khẩu ở màn Thông tin cá nhân. Màn này mở cho mọi người đăng nhập.',
      },
      {
        kind: 'steps',
        items: [
          'Bấm vào tên bạn ở góc dưới bên trái thanh điều hướng.',
          'Chọn **Thông tin cá nhân**.',
          'Bấm **Đổi mật khẩu**.',
          'Điền **Mật khẩu hiện tại**, **Mật khẩu mới**, **Nhập lại mật khẩu mới**.',
          'Bấm lưu.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/profile-page.png',
          alt: 'Màn Thông tin cá nhân với nút Đổi mật khẩu',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 34.9, y: 15.6, label: 'Khối Tài khoản — tên đăng nhập, chức danh, số quyền được cấp.' },
            { n: 2, x: 54.2, y: 15.6, label: 'Nút Đổi mật khẩu.' },
          ],
        },
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/change-password-form.png',
          alt: 'Biểu mẫu Đổi mật khẩu',
          width: 560,
          height: 396,
          markers: [
            { n: 1, x: 50, y: 24.8, label: 'Mật khẩu hiện tại.' },
            { n: 2, x: 50, y: 44, label: 'Mật khẩu mới.' },
            { n: 3, x: 50, y: 63.2, label: 'Nhập lại mật khẩu mới.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn quên mật khẩu thì không tự đổi được. Bạn nhờ quản lý mở hồ sơ của bạn và bấm **Đặt lại mật khẩu**. Quản lý sẽ đọc mật khẩu mới cho bạn.',
      },
    ],
  },
  {
    slug: 'tao-nhan-vien',
    title: 'Tạo nhân viên',
    screen: 'P-51',
    group: 'people',
    summary: 'Tạo hồ sơ kiêm tài khoản đăng nhập. Mật khẩu chỉ hiện một lần.',
    keywords: [
      'tạo nhân viên',
      'thêm nhân viên',
      'tài khoản mới',
      'nhân viên mới',
      'cấp tài khoản',
      'tuyển mới',
      'mật khẩu ban đầu',
    ],
    visibleTo: (user) => can(user, 'staff', 'create') || can(user, 'staff', 'update'),
    blocks: [
      {
        kind: 'text',
        body: 'Nhân viên và tài khoản đăng nhập là một thứ. Bạn tạo nhân viên là tạo luôn tài khoản.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Mật khẩu chỉ hiện một lần. Bạn chép và gửi cho nhân viên trước khi đóng hộp thoại. Lỡ đóng rồi thì bạn mở hồ sơ của họ và bấm **Đặt lại mật khẩu**.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/users-page.png',
          alt: 'Màn Nhân sự với nút Thêm nhân viên',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 42, label: 'Mục Nhân sự trên thanh điều hướng.' },
            { n: 2, x: 91.5, y: 4.1, label: 'Nút Thêm nhân viên.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Nhân sự**.',
          'Bấm **Thêm nhân viên** ở góc trên bên phải.',
          'Điền **Họ tên**, **Mã nhân viên**, **Số điện thoại**.',
          'Kiểm tra **Tên đăng nhập**. Hệ thống tự sinh từ mã nhân viên, bạn sửa lại được.',
          'Chọn **Đơn vị** và **Chức vụ**.',
          'Bấm **Tạo nhân viên**.',
          'Bấm **Chép cả hai** rồi gửi tên đăng nhập và mật khẩu cho nhân viên.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/staff-form.png',
          alt: 'Biểu mẫu Thêm nhân viên',
          width: 560,
          height: 556,
          markers: [
            { n: 1, x: 50, y: 17.7, label: 'Họ tên nhân viên.' },
            { n: 2, x: 26.3, y: 31.4, label: 'Mã nhân viên theo danh sách nhân sự.' },
            { n: 3, x: 50, y: 45.1, label: 'Tên đăng nhập — hệ thống tự sinh, sửa được.' },
            { n: 4, x: 31.3, y: 58.5, label: 'Đơn vị — phòng nhân viên thuộc về.' },
            { n: 5, x: 73.6, y: 58.5, label: 'Chức vụ — quyết định bộ quyền mặc định.' },
            { n: 6, x: 85.2, y: 93.5, label: 'Nút Tạo nhân viên.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Chức vụ chỉ là bộ quyền mặc định lúc tạo. Bạn sửa quyền thật của từng người ở khối Quyền. Xem bài **Cấp quyền cho nhân viên**.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Nhân viên đăng nhập rồi tự đổi mật khẩu ở màn Thông tin cá nhân.',
      },
    ],
  },
  {
    slug: 'cap-quyen-nhan-vien',
    title: 'Cấp quyền cho nhân viên',
    screen: 'P-92',
    group: 'people',
    summary: 'Bật tắt từng quyền và chọn phạm vi dữ liệu cho một nhân viên.',
    keywords: [
      'cấp quyền',
      'phân quyền',
      'phạm vi',
      'quyền hạn',
      'khối quyền',
      'không thấy menu',
      'không mở được màn',
      'không thấy nút',
      'chỉ thấy khách của mình',
      'toàn quyền',
    ],
    visibleTo: (user) =>
      (user.manageScope !== 'none' || can(user, 'staff', 'create')) &&
      (can(user, 'staff', 'update') || can(user, 'system', 'grant-permission')),
    blocks: [
      {
        kind: 'text',
        body: 'Quyền quyết định hai thứ. Một là mục nào hiện trên thanh điều hướng. Hai là người đó thấy dữ liệu tới đâu.',
      },
      {
        kind: 'text',
        body: 'Mỗi quyền gồm ba phần. Phần một là nhóm màn hình, ví dụ Khách hàng, Bảo hiểm. Phần hai là hành động, ví dụ Xem chi tiết, Thêm mới. Phần ba là phạm vi: Của tôi, Phòng tôi quản, hoặc Toàn công ty.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bạn chỉ cấp được quyền không rộng hơn trần cấp quyền của chính bạn. Bạn mở hồ sơ của chính mình thì hộp thoại không có khối Quyền.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Nhân sự**.',
          'Bấm vào tên nhân viên trong bảng.',
          'Chuyển sang tab **Tài khoản & quyền**.',
          'Bấm **Sửa**.',
          'Mở khối **Quyền** trong hộp thoại.',
          'Bật hoặc tắt từng quyền. Chọn phạm vi cho quyền đó.',
          'Bấm **Lưu**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/staff-permissions.png',
          alt: 'Khối Quyền trong hộp thoại nhân viên',
          width: 560,
          height: 736,
          markers: [
            { n: 1, x: 50, y: 62, label: 'Khối Quyền — bấm để mở.' },
            { n: 2, x: 24.2, y: 70.3, label: 'Công tắc Toàn quyền — cấp đủ mọi quyền, phạm vi toàn công ty.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn cuộn xuống dưới công tắc Toàn quyền để bật tắt từng quyền lẻ. Công tắc Toàn quyền chỉ bấm được nếu bạn cầm quyền Cấp quyền.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Ba hành động không chia được theo phạm vi, chỉ Bật hoặc Tắt: Sửa cơ cấu tổ chức, Cộng điểm KPI, Sửa trạng thái đơn bảo hiểm.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Người đó phải đăng xuất rồi đăng nhập lại thì thanh điều hướng mới đổi. Máy chủ áp quyền mới ngay lập tức, nên trong lúc đó họ bấm vào mục cũ sẽ nhận báo lỗi.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Nhân viên báo không thấy một mục trên thanh điều hướng thì thường là thiếu quyền. Bạn mở khối Quyền của người đó trước khi báo lỗi.',
      },
    ],
  },
  {
    slug: 'khoa-tai-khoan-nhan-vien',
    title: 'Khoá tài khoản và đặt lại mật khẩu',
    screen: 'P-52',
    group: 'people',
    summary: 'Khoá tài khoản khi nhân viên nghỉ việc. Đặt lại mật khẩu khi họ quên.',
    keywords: [
      'khoá tài khoản',
      'mở khoá',
      'nghỉ việc',
      'đặt lại mật khẩu',
      'nhân viên quên mật khẩu',
      'cấm đăng nhập',
      'nhân viên nghỉ',
    ],
    visibleTo: (user) => can(user, 'staff', 'create') || can(user, 'staff', 'update'),
    blocks: [
      {
        kind: 'text',
        body: 'Ba nút này nằm ở tab **Tài khoản & quyền** trong hồ sơ nhân viên: **Sửa**, **Đặt lại mật khẩu**, **Khoá tài khoản**.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bạn khoá tài khoản thì người đó không đăng nhập được nữa. Dòng của họ biến mất khỏi bảng Nhân sự vì bảng chỉ hiện người đang làm. Bạn mở khoá ở chính hồ sơ của họ.',
      },
      {
        kind: 'steps',
        items: [
          'Mở mục **Nhân sự**.',
          'Bấm vào tên nhân viên trong bảng.',
          'Chuyển sang tab **Tài khoản & quyền**.',
          'Nhân viên nghỉ việc thì bạn bấm **Khoá tài khoản**, rồi xác nhận.',
          'Nhân viên quên mật khẩu thì bạn bấm **Đặt lại mật khẩu**, rồi xác nhận.',
          'Chép mật khẩu mới và gửi cho nhân viên.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/staff-account-tab.png',
          alt: 'Tab Tài khoản và quyền trong hồ sơ nhân viên',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 36.2, y: 18.7, label: 'Tab Tài khoản & quyền.' },
            { n: 2, x: 32.9, y: 81.9, label: 'Nút Đặt lại mật khẩu — dùng khi nhân viên quên mật khẩu.' },
            { n: 3, x: 44.3, y: 81.9, label: 'Nút Khoá tài khoản — dùng khi nhân viên nghỉ việc.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Đặt lại mật khẩu thì mật khẩu cũ mất ngay. Mọi thiết bị người đó đang đăng nhập đều bị đăng xuất.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn khoá tài khoản thì các bản ghi cũ vẫn giữ nguyên tên người đó. Điểm KPI và lịch sử không mất.',
      },
    ],
  },
];
